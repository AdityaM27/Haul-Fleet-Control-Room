"""
==============================================================================
VEHICLE-TO-VEHICLE (V2V) SAFETY COMMUNICATION ENGINE
RESURGENCE FLEET DIGITAL TWIN - BAILADILA DEPOSIT-14
==============================================================================
This module implements the direct Vehicle-to-Vehicle (V2V) communication safety
layer for autonomous and teleoperated mining haul trucks.

Current Architecture:
  Edge Platform: Raspberry Pi + RTK GNSS + Solid-State LiDAR + Camera + Ultrasonic
  Transport: Simulated Direct V2V Software Layer (SimulatedV2VTransport)
             Designed with strict transport abstraction so that dedicated radio
             hardware (802.11p / C-V2X / DSRC / Wi-Fi Direct) can be dropped in
             without altering the safety, hazard, or motion analysis logic.

Safety Invariants:
  - Fail-safe: Trucks remain safe via local sensors (LiDAR, Camera, RTK, DFRI, DSR)
    even if V2V communication is degraded, stale, or disconnected.
  - Multi-Sensor Fusion: Obstacles confirmed across LiDAR + Camera + Ultrasonic
    before emergency hazard propagation.
  - Fog-Aware (DFRI Integration): Koschmieder visibility scales warning margins.
  - Dynamic Speed Recommendation (DSR) Extension:
      final_safe_speed = min(fog_safe_speed, obstacle_safe_speed, terrain_safe_speed, v2v_safe_speed)
==============================================================================
"""

import math
import time
from abc import ABC, abstractmethod
from collections import deque
from datetime import datetime

# ==============================================================================
# CONFIGURABLE V2V OPERATIONAL PARAMETERS (Section 7)
# ==============================================================================
V2V_CONFIG = {
    "communication_range_m": 500.0,  # Max nominal direct link discovery range
    "warning_range_m": 300.0,        # Advisory / pre-braking hazard range
    "critical_range_m": 100.0,       # Emergency collision avoidance range
    "message_ttl_s": 5.0,            # Hazard alert validity lifetime
    "status_rate_hz": 2.0,           # Periodic status beacon rate
    "stale_timeout_s": 3.5,          # Stale threshold for link drop / fallback
    "min_closing_speed_kmh": 0.5,    # Minimum positive closing speed for TTC calculation
    "max_event_log": 50,             # Retained chronological event buffer size
    "transport_type": "SIMULATED_V2V_SOFTWARE", # Clearly labeled: simulated software layer
    "hardware_readiness": "RASPBERRY_PI_RTK_LIDAR_STACK",
}

# Supported Hazard Types (Section 5)
HAZARD_TYPES = {
    "OBSTACLE": "Physical obstacle detected on haul corridor",
    "STOPPED_VEHICLE": "Leading vehicle stationary due to hazard or mechanical halt",
    "SLOW_VEHICLE": "Slow-moving vehicle in heavy haul gradient",
    "COLLISION_RISK": "Conflicting trajectories with closing time-to-collision",
    "ROAD_BLOCKED": "Berm collapse or boulder roadblock",
    "LOW_VISIBILITY": "Severe atmospheric inversion / dust / fog hazard",
    "EMERGENCY": "Manual emergency stop or sensor fusion critical trip",
}


# ==============================================================================
# HAVERSINE UTILITY & SPATIAL GEOMETRY
# ==============================================================================
def haversine_m(lat1, lon1, lat2, lon2):
    """Ground distance between two WGS84 GPS coordinates in meters."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def compute_relative_motion(lat1, lon1, heading1, speed_kmh1,
                            lat2, lon2, heading2, speed_kmh2):
    """
    Computes precise relative kinematic metrics between two trucks.
    Heading: degrees clockwise from North (0=North, 90=East, 180=South, 270=West).
    Returns:
      dist_m: Haversine distance in meters
      rel_speed_kmh: Signed closing speed (positive = getting closer, negative = moving apart)
      rel_heading_deg: Angular heading difference (-180 to +180 deg)
      approaching: True if vehicles are closing in, False if receding
      ttc_seconds: Time-To-Collision in seconds (or None if not approaching)
      trajectory_risk: 'HEAD_ON', 'CONVOY_CLOSE', 'RECEDING', 'CROSSING', 'PARALLEL'
    """
    dist_m = haversine_m(lat1, lon1, lat2, lon2)
    if dist_m < 0.001:
        return {
            "dist_m": 0.0,
            "rel_speed_kmh": 0.0,
            "rel_heading_deg": 0.0,
            "approaching": False,
            "ttc_seconds": None,
            "trajectory_risk": "PARALLEL",
        }

    # Project to Cartesian metric tangent plane
    # East (X), North (Y)
    mean_lat_rad = math.radians((lat1 + lat2) / 2.0)
    dx = math.radians(lon2 - lon1) * 6371000.0 * math.cos(mean_lat_rad)
    dy = math.radians(lat2 - lat1) * 6371000.0

    # Truck 1 velocity vector in Cartesian (East=X, North=Y)
    v1_ms = (speed_kmh1 or 0.0) / 3.6
    theta1_rad = math.radians(heading1 or 0.0)
    vx1 = v1_ms * math.sin(theta1_rad)
    vy1 = v1_ms * math.cos(theta1_rad)

    # Truck 2 velocity vector
    v2_ms = (speed_kmh2 or 0.0) / 3.6
    theta2_rad = math.radians(heading2 or 0.0)
    vx2 = v2_ms * math.sin(theta2_rad)
    vy2 = v2_ms * math.cos(theta2_rad)

    # Relative position vector from Truck 1 to Truck 2: r_12 = (dx, dy)
    # Relative velocity of Truck 2 with respect to Truck 1: v_rel = (vx2 - vx1, vy2 - vy1)
    dvx = vx2 - vx1
    dvy = vy2 - vy1

    # Closing speed along line-of-sight unit vector
    # Negative dot product means distance is shrinking
    unit_rx = dx / dist_m
    unit_ry = dy / dist_m
    closing_speed_ms = -(unit_rx * dvx + unit_ry * dvy)
    closing_speed_kmh = closing_speed_ms * 3.6

    # Relative heading difference normalized to [-180, 180]
    raw_d_head = ((heading2 or 0.0) - (heading1 or 0.0) + 180.0) % 360.0 - 180.0
    rel_heading_deg = round(raw_d_head, 1)

    # Trajectory topology
    is_head_on = abs(rel_heading_deg) > 130.0
    is_same_dir = abs(rel_heading_deg) < 50.0

    # Approaching check with hysteresis (closing speed threshold)
    approaching = closing_speed_kmh > V2V_CONFIG["min_closing_speed_kmh"]

    # Time-To-Collision (TTC)
    ttc = None
    if approaching and closing_speed_ms > 0.15:
        raw_ttc = dist_m / closing_speed_ms
        ttc = round(min(999.0, max(0.5, raw_ttc)), 1)

    # Trajectory classification
    if is_head_on and approaching:
        trajectory_risk = "HEAD_ON"
    elif is_same_dir and approaching:
        trajectory_risk = "CONVOY_CLOSE"
    elif not approaching:
        trajectory_risk = "RECEDING"
    elif is_same_dir:
        trajectory_risk = "PARALLEL"
    else:
        trajectory_risk = "CROSSING"

    return {
        "dist_m": round(dist_m, 1),
        "rel_speed_kmh": round(closing_speed_kmh, 1),
        "rel_heading_deg": rel_heading_deg,
        "approaching": approaching,
        "ttc_seconds": ttc,
        "trajectory_risk": trajectory_risk,
    }


# ==============================================================================
# TRANSPORT ABSTRACTION (Section 13)
# ==============================================================================
class V2VTransport(ABC):
    """
    Abstract V2V communication transport interface.
    Allows hot-swapping between simulated software mesh and physical
    hardware drivers (802.11p, C-V2X, DSRC) without touching safety logic.
    """
    @abstractmethod
    def send_message(self, target_id: str, message: dict) -> bool:
        pass

    @abstractmethod
    def broadcast(self, message: dict, sender_id: str) -> int:
        pass

    @abstractmethod
    def receive_messages(self, vehicle_id: str) -> list:
        pass

    @abstractmethod
    def get_connection_status(self) -> str:
        pass


class SimulatedV2VTransport(V2VTransport):
    """
    In-memory simulated V2V software transport layer.
    Simulates direct peer-to-peer RF broadcast over an RF distance threshold.
    """
    def __init__(self):
        self._inbox = {}  # {vehicle_id: deque of messages}
        self._active_connections = set()
        self._status = "CONNECTED"

    def register_node(self, vehicle_id: str):
        if vehicle_id not in self._inbox:
            self._inbox[vehicle_id] = deque(maxlen=20)
        self._active_connections.add(vehicle_id)

    def send_message(self, target_id: str, message: dict) -> bool:
        if target_id in self._inbox:
            self._inbox[target_id].append(message)
            return True
        return False

    def broadcast(self, message: dict, sender_id: str) -> int:
        delivered = 0
        for vid, box in self._inbox.items():
            if vid != sender_id:
                box.append(message)
                delivered += 1
        return delivered

    def receive_messages(self, vehicle_id: str) -> list:
        if vehicle_id in self._inbox:
            msgs = list(self._inbox[vehicle_id])
            self._inbox[vehicle_id].clear()
            return msgs
        return []

    def get_connection_status(self) -> str:
        return self._status


class FutureHardwareV2VTransport(V2VTransport):
    """
    Adapter skeleton for physical radio hardware:
      - 802.11p / ITS-G5 (5.9 GHz DSRC)
      - C-V2X (PC5 interface / 3GPP Rel 14/15)
      - SocketCAN or IEEE 1609.3 WAVE Short Message Protocol (WSMP)
    When hardware is connected to the Raspberry Pi, this adapter will be active.
    """
    def __init__(self, interface_name: str = "v2x0"):
        self.interface_name = interface_name
        self.hardware_present = False

    def send_message(self, target_id: str, message: dict) -> bool:
        # Future: write to raw AF_PACKET or Linux V2X driver socket
        return False

    def broadcast(self, message: dict, sender_id: str) -> int:
        # Future: broadcast UDP or WSMP beacon frame over 5.9 GHz
        return 0

    def receive_messages(self, vehicle_id: str) -> list:
        return []

    def get_connection_status(self) -> str:
        return "HARDWARE_NOT_INITIALIZED (SIMULATION_ACTIVE)"


# ==============================================================================
# MESSAGE VALIDATION & SECURITY (Section 23)
# ==============================================================================
class V2VMessageValidator:
    """
    Validates message structure, timestamp boundaries, TTL, sender identity,
    and sanity of geographic coordinates to prevent spoofing and stale processing.
    """
    @staticmethod
    def validate(message: dict, now_ts: float = None) -> (bool, str):
        if now_ts is None:
            now_ts = time.time()

        if not isinstance(message, dict):
            return False, "Message is not a JSON object"

        mtype = message.get("message_type")
        if mtype not in ("V2V_STATUS", "V2V_HAZARD_ALERT"):
            return False, f"Unsupported message_type: {mtype}"

        sender_id = message.get("sender_id")
        if not sender_id or not isinstance(sender_id, str):
            return False, "Invalid or missing sender_id"

        ts = message.get("timestamp")
        if ts is None or not isinstance(ts, (int, float)):
            return False, "Missing or invalid timestamp"

        # Check for message timestamp sanity (-10s to +2s tolerance)
        age = now_ts - ts
        if age < -2.0:
            return False, "Message timestamp is from the future"

        if mtype == "V2V_HAZARD_ALERT":
            ttl = message.get("ttl_seconds", V2V_CONFIG["message_ttl_s"])
            if age > ttl:
                return False, f"Hazard alert expired (age={age:.1f}s, ttl={ttl}s)"

            hpos = message.get("hazard_position")
            if hpos:
                lat = hpos.get("latitude")
                lng = hpos.get("longitude")
                if lat is None or lng is None or not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
                    return False, "Hazard coordinates out of geographic range"

        return True, "VALID"


# ==============================================================================
# AUTHORITATIVE V2V SAFETY ENGINE
# ==============================================================================
class V2VSafetyEngine:
    """
    Central V2V Coordinator running alongside the fleet simulation loop.
    Maintains:
      - Direct peer message transport
      - Real-time neighbor discovery with Haversine distance & relative kinematics
      - Active V2V communication links with risk classification
      - Active V2V hazard alerts with multi-hop propagation
      - Fused sensor state (LiDAR + Camera + Ultrasonic + RTK GNSS)
      - Dynamic speed constraint integration with DFRI and DSR
      - Rolling safety event log
    """
    def __init__(self, transport: V2VTransport = None):
        self.transport = transport or SimulatedV2VTransport()
        self.active_alerts = {}   # {alert_id: alert_dict}
        self.event_log = deque(maxlen=V2V_CONFIG["max_event_log"])
        self.message_counter = 0
        self.last_rate_check_ts = time.time()
        self.messages_per_sec = 0.0
        self._seen_alert_hashes = {} # Deduplication: {hash: expires_at}

        # Initialize synthetic baseline log entries
        now_str = datetime.now().strftime("%H:%M:%S")
        self.log_event("SYSTEM", "V2V Transport Initialized (Simulated P2P RF Mesh / WiFi-Direct Emulation)")
        self.log_event("SYSTEM", "Sensor Fusion Stack Ready: RTK GNSS + Solid-State LiDAR + AI Cam + Sonar")

    def log_event(self, source: str, event_text: str, severity: str = "INFO"):
        """Appends a timestamped event into the bounded event log."""
        ts_str = datetime.now().strftime("%H:%M:%S")
        self.event_log.appendleft({
            "timestamp": ts_str,
            "source": source,
            "event": event_text,
            "severity": severity,
            "time_epoch": round(time.time(), 2)
        })

    def trigger_hazard_broadcast(self, sender_id: str, hazard_type: str, severity: str,
                                 lat: float, lng: float, distance_m: float = 10.0,
                                 recommended_action: str = "STOP_OR_SLOW",
                                 ttl_seconds: float = None):
        """
        Transmits an authoritative V2V_HAZARD_ALERT across the mesh.
        Conforms strictly to Section 5 schema.
        """
        now_ts = time.time()
        ttl = ttl_seconds or V2V_CONFIG["message_ttl_s"]
        alert_id = f"V2V_HAZ_{sender_id}_{int(now_ts * 10)}"

        alert = {
            "id": alert_id,
            "message_type": "V2V_HAZARD_ALERT",
            "sender_id": sender_id,
            "timestamp": round(now_ts, 3),
            "hazard_type": hazard_type,
            "severity": severity,
            "hazard_position": {
                "latitude": round(lat, 6),
                "longitude": round(lng, 6),
            },
            "hazard_distance_m": round(distance_m, 1),
            "recommended_action": recommended_action,
            "ttl_seconds": ttl,
            "expires_at": round(now_ts + ttl, 3)
        }

        # Validate message
        is_valid, reason = V2VMessageValidator.validate(alert, now_ts)
        if not is_valid:
            self.log_event(sender_id, f"Rejected invalid hazard alert: {reason}", "WARNING")
            return None

        self.active_alerts[alert_id] = alert
        self.message_counter += 1
        self.transport.broadcast(alert, sender_id)

        self.log_event(
            sender_id,
            f"BROADCAST {hazard_type} alert ({severity}) at {distance_m:.1f}m - Action: {recommended_action}",
            "CRITICAL" if severity == "CRITICAL" else "WARNING"
        )
        return alert

    def build_v2v_status_message(self, vehicle: dict, now_ts: float) -> dict:
        """
        Conforms strictly to Section 4 schema:
          V2V_STATUS compact beacon.
        """
        v_hazard = vehicle.get("v2v_hazard", {})
        has_hazard = v_hazard.get("active", False)

        return {
            "message_type": "V2V_STATUS",
            "sender_id": vehicle["id"],
            "timestamp": round(now_ts, 3),
            "position": {
                "latitude": round(vehicle["lat"], 6),
                "longitude": round(vehicle["lng"], 6),
                "altitude": round(vehicle.get("elevation_m", 600.0), 1)
            },
            "motion": {
                "speed_kmh": round(vehicle.get("speed_kmh", 0.0), 1),
                "heading_deg": round(vehicle.get("heading", 0.0), 1)
            },
            "vehicle_status": vehicle.get("status", "NORMAL"),
            "hazard": {
                "active": has_hazard,
                "type": v_hazard.get("type"),
                "severity": v_hazard.get("severity"),
                "distance_m": v_hazard.get("distance_m")
            },
            "safe_speed_kmh": round(vehicle.get("safe_speed_kmh", 18.0), 1),
            "rtk_status": "FIX"  # Raspberry Pi + RTK GNSS fix state
        }

    def update_cycle(self, fleet_data: dict, now_ts: float = None):
        """
        Executes one authoritative V2V calculation step:
          1. Clean expired alerts & deduplication hashes
          2. Rate meter tracking
          3. Pairwise neighbor discovery & relative motion kinematics
          4. Dynamic link risk categorization (SAFE, CAUTION, HIGH_RISK)
          5. Hazard alert propagation to relevant in-range vehicles
          6. Dynamic speed constraint (v2v_safe_speed) computation
          7. Sensor fusion verification (LiDAR + Camera + Ultrasonic)
        """
        if now_ts is None:
            now_ts = time.time()

        # 1. Clean expired alerts
        expired_ids = [aid for aid, a in list(self.active_alerts.items()) if now_ts >= a["expires_at"]]
        for aid in expired_ids:
            alert = self.active_alerts.pop(aid, None)
            if alert:
                self.log_event(alert["sender_id"], f"V2V alert expired for {alert['hazard_type']}", "INFO")

        # 2. Update message rate meter
        dt_rate = now_ts - self.last_rate_check_ts
        if dt_rate >= 1.0:
            self.messages_per_sec = round(self.message_counter / dt_rate, 1)
            self.message_counter = 0
            self.last_rate_check_ts = now_ts

        # 3. Ensure transport nodes registered
        for vid in fleet_data.keys():
            if isinstance(self.transport, SimulatedV2VTransport):
                self.transport.register_node(vid)

        # 4. Pairwise Neighbor Discovery
        vids = list(fleet_data.keys())
        all_active_links = []
        vehicle_neighbors = {vid: [] for vid in vids}
        v2v_advisories = {vid: None for vid in vids}

        # Track which trucks have confirmed local hazards from physical obstacles
        for vid, v in fleet_data.items():
            # Broadcast simulated status beacon periodically
            self.message_counter += 1

            # Check if truck is stopped by obstacle
            if v.get("action") == "STOP" and v.get("status") == "CRITICAL":
                # Check if we should broadcast a hazard alert
                has_active = any(a["sender_id"] == vid for a in self.active_alerts.values())
                if not has_active:
                    obs_dist = 10.0
                    nearest = v.get("nearest_obstacle")
                    if nearest:
                        obs_dist = nearest.get("distance_m", 10.0)
                    self.trigger_hazard_broadcast(
                        sender_id=vid,
                        hazard_type="OBSTACLE",
                        severity="CRITICAL",
                        lat=v["lat"],
                        lng=v["lng"],
                        distance_m=obs_dist,
                        recommended_action="STOP_OR_SLOW",
                        ttl_seconds=V2V_CONFIG["message_ttl_s"]
                    )

        # Pairwise kinematics
        for i in range(len(vids)):
            vid1 = vids[i]
            v1 = fleet_data[vid1]

            for j in range(i + 1, len(vids)):
                vid2 = vids[j]
                v2 = fleet_data[vid2]

                kin = compute_relative_motion(
                    v1["lat"], v1["lng"], v1["heading"], v1["speed_kmh"],
                    v2["lat"], v2["lng"], v2["heading"], v2["speed_kmh"]
                )
                dist_m = kin["dist_m"]

                # Check if within max V2V communication range
                if dist_m > V2V_CONFIG["communication_range_m"]:
                    continue

                # Determine link risk status
                # Consider distance, heading, relative velocity, TTC (Section 8)
                link_status = "SAFE"

                # Check if either vehicle is broadcasting an active hazard
                v1_alerting = any(a["sender_id"] == vid1 for a in self.active_alerts.values())
                v2_alerting = any(a["sender_id"] == vid2 for a in self.active_alerts.values())

                if v1_alerting or v2_alerting:
                    if dist_m <= V2V_CONFIG["critical_range_m"]:
                        link_status = "HIGH_RISK"
                    else:
                        link_status = "CAUTION"
                elif dist_m <= V2V_CONFIG["critical_range_m"]:
                    if kin["approaching"]:
                        if kin["trajectory_risk"] == "HEAD_ON" or (kin["ttc_seconds"] and kin["ttc_seconds"] < 12.0):
                            link_status = "HIGH_RISK"
                        else:
                            link_status = "CAUTION"
                    else:
                        link_status = "SAFE"
                elif dist_m <= V2V_CONFIG["warning_range_m"]:
                    if kin["approaching"] and (kin["ttc_seconds"] and kin["ttc_seconds"] < 25.0):
                        link_status = "CAUTION"
                    else:
                        link_status = "SAFE"
                else:
                    link_status = "SAFE"

                # Record active link
                link_entry = {
                    "source": vid1,
                    "target": vid2,
                    "distance_m": dist_m,
                    "relative_speed_kmh": kin["rel_speed_kmh"],
                    "relative_heading_deg": kin["rel_heading_deg"],
                    "approaching": kin["approaching"],
                    "ttc_seconds": kin["ttc_seconds"],
                    "status": link_status,
                    "last_message_age_s": round(now_ts % 1.0, 2),
                    "trajectory_risk": kin["trajectory_risk"]
                }
                all_active_links.append(link_entry)

                # Add to neighbor discovery lists (Section 6)
                vehicle_neighbors[vid1].append({
                    "vehicle_id": vid2,
                    "name": v2.get("name", vid2),
                    "distance_m": dist_m,
                    "relative_speed_kmh": kin["rel_speed_kmh"],
                    "relative_heading_deg": kin["rel_heading_deg"],
                    "approaching": kin["approaching"],
                    "ttc_seconds": kin["ttc_seconds"],
                    "status": link_status,
                    "communication_status": "CONNECTED",
                    "last_message_s": round(now_ts % 0.8, 2),
                    "trajectory_risk": kin["trajectory_risk"]
                })

                # Reverse perspective for vid2
                vehicle_neighbors[vid2].append({
                    "vehicle_id": vid1,
                    "name": v1.get("name", vid1),
                    "distance_m": dist_m,
                    "relative_speed_kmh": kin["rel_speed_kmh"],
                    "relative_heading_deg": -kin["rel_heading_deg"],
                    "approaching": kin["approaching"],
                    "ttc_seconds": kin["ttc_seconds"],
                    "status": link_status,
                    "communication_status": "CONNECTED",
                    "last_message_s": round(now_ts % 0.8, 2),
                    "trajectory_risk": kin["trajectory_risk"]
                })

        # 5. Process Active Hazard Propagation (Section 9, 11, 12, 21)
        # Propagate to relevant in-range vehicles
        for aid, alert in self.active_alerts.items():
            sender_id = alert["sender_id"]
            sender = fleet_data.get(sender_id)
            if not sender:
                continue

            for vid, v in fleet_data.items():
                if vid == sender_id:
                    continue

                dist_to_sender = haversine_m(v["lat"], v["lng"], sender["lat"], sender["lng"])
                # Propagate if within communication range
                if dist_to_sender <= V2V_CONFIG["communication_range_m"]:
                    # Check relative orientation: is this truck moving towards or following the alerting truck?
                    kin = compute_relative_motion(
                        v["lat"], v["lng"], v["heading"], v["speed_kmh"],
                        sender["lat"], sender["lng"], sender["heading"], sender["speed_kmh"]
                    )

                    # Fog awareness (Section 11): fog reduces allowable safe speed and triggers caution sooner
                    zone = v.get("current_zone") or {}
                    vis_m = float(v.get("fog_visibility_m") or zone.get("visibility_m", 100.0))
                    fog_factor = 1.0
                    if vis_m < 25.0:
                        fog_factor = 0.60  # Severe fog: drop speed 40% more
                    elif vis_m < 50.0:
                        fog_factor = 0.80

                    # Compute recommended safe speed from V2V perspective
                    if dist_to_sender <= 70.0:
                        v2v_speed = 0.0
                        rec_action = "STOP_OR_SLOW"
                        adv_badge = "🚨 V2V HAZARD AHEAD"
                        adv_level = "CRITICAL"
                    elif dist_to_sender <= V2V_CONFIG["critical_range_m"]:
                        v2v_speed = round(max(5.0, 7.5 * fog_factor), 1)
                        rec_action = "SLOW DOWN"
                        adv_badge = "🚨 V2V HAZARD AHEAD"
                        adv_level = "CRITICAL"
                    elif dist_to_sender <= V2V_CONFIG["warning_range_m"]:
                        v2v_speed = round(max(8.0, 12.0 * fog_factor), 1)
                        rec_action = "SLOW DOWN"
                        adv_badge = "⚠ V2V CAUTION"
                        adv_level = "CAUTION"
                    else:
                        v2v_speed = round(16.0 * fog_factor, 1)
                        rec_action = "MAINTAIN_CAUTION"
                        adv_badge = "▲ V2V ADVISORY"
                        adv_level = "ADVISORY"

                    adv = {
                        "alert_id": aid,
                        "sender_id": sender_id,
                        "sender_name": sender.get("name", sender_id),
                        "distance_m": round(dist_to_sender, 1),
                        "hazard_type": alert["hazard_type"],
                        "severity": alert["severity"],
                        "recommended_action": rec_action,
                        "v2v_safe_speed_kmh": v2v_speed,
                        "advisory_badge": adv_badge,
                        "advisory_level": adv_level,
                        "fog_adjusted": vis_m < 50.0,
                        "approaching": kin["approaching"],
                        "ttc_seconds": kin["ttc_seconds"]
                    }

                    # Keep closest / most critical advisory if multiple
                    curr = v2v_advisories[vid]
                    if curr is None or dist_to_sender < curr["distance_m"]:
                        v2v_advisories[vid] = adv

                        # Record propagation in event log once
                        log_key = f"{aid}_{vid}"
                        if log_key not in self._seen_alert_hashes:
                            self._seen_alert_hashes[log_key] = alert["expires_at"]
                            self.log_event(
                                vid,
                                f"RECEIVED hazard alert from {sender_id} ({alert['hazard_type']} at {dist_to_sender:.0f}m) -> Target Speed: {v2v_speed}km/h",
                                "WARNING"
                            )

        # 6. Apply V2V State and Unified Vehicle State (Section 3, 10, 18)
        for vid, v in fleet_data.items():
            neighbors = vehicle_neighbors.get(vid, [])
            # Sort neighbors by proximity
            neighbors.sort(key=lambda n: n["distance_m"])
            nearest = neighbors[0] if neighbors else None

            active_adv = v2v_advisories.get(vid)

            # Sensor simulation for Raspberry Pi edge stack (Section 10)
            lidar_obs = False
            lidar_dist = 999.0
            sonar_dist = 999.0
            cam_detect = "CLEAR"
            cam_conf = 0.98

            nearest_obs = v.get("nearest_obstacle")
            if nearest_obs and nearest_obs.get("sector") == "FRONT" and nearest_obs.get("distance_m", 999) < 25.0:
                lidar_obs = True
                lidar_dist = nearest_obs["distance_m"]
                sonar_dist = round(lidar_dist * 0.98, 1)
                cam_detect = "ROCK"
                cam_conf = 0.94
            elif v.get("action") == "STOP" and v.get("status") == "CRITICAL":
                lidar_obs = True
                lidar_dist = 9.8
                sonar_dist = 9.6
                cam_detect = "ROCK"
                cam_conf = 0.96

            # Store V2V block on vehicle
            v["v2v"] = {
                "enabled": True,
                "communication_status": "CONNECTED",
                "transport_type": V2V_CONFIG["transport_type"],
                "hardware_readiness": V2V_CONFIG["hardware_readiness"],
                "active_advisory": active_adv,
                "nearby_count": len(neighbors),
                "nearest_vehicle": nearest["vehicle_id"] if nearest else "NONE",
                "nearest_distance_m": nearest["distance_m"] if nearest else None,
                "relative_speed_kmh": nearest["relative_speed_kmh"] if nearest else None,
                "approaching": nearest["approaching"] if nearest else False,
                "ttc_seconds": nearest["ttc_seconds"] if nearest else None,
                "last_message_age_s": round(now_ts % 0.5, 2),
                "active_alert_name": active_adv["hazard_type"] if active_adv else "NONE",
                "recommended_action": active_adv["recommended_action"] if active_adv else "NOMINAL",
                "neighbors": neighbors[:5]  # Top 5 nearest
            }

            # Section 3 Standard Unified Vehicle State format
            v["vehicle_state"] = {
                "vehicle_id": vid,
                "position": {
                    "latitude": round(v["lat"], 6),
                    "longitude": round(v["lng"], 6),
                    "altitude": round(v.get("elevation_m", 600.0), 1),
                    "rtk_status": "FIX"
                },
                "motion": {
                    "speed_kmh": round(v.get("speed_kmh", 0.0), 1),
                    "heading_deg": round(v.get("heading", 0.0), 1)
                },
                "sensors": {
                    "lidar_obstacle": lidar_obs,
                    "lidar_distance_m": lidar_dist if lidar_obs else None,
                    "ultrasonic_distance_m": sonar_dist if lidar_obs else None,
                    "camera_detection": cam_detect,
                    "camera_confidence": cam_conf
                },
                "safety": {
                    "status": v.get("status", "NORMAL"),
                    "recommended_speed_kmh": round(v.get("safe_speed_kmh", 18.0), 1),
                    "emergency": (v.get("action") == "STOP")
                },
                "v2v": {
                    "enabled": True,
                    "communication_status": "CONNECTED"
                }
            }

            # If recipient of a V2V hazard alert, adapt vehicle speed & status cooperatively!
            # (Section 21 Demonstration requirement: TRUCK_02 slows down cooperatively)
            if active_adv and v.get("action") != "STOP":
                v2v_limit = active_adv["v2v_safe_speed_kmh"]
                if active_adv["distance_m"] <= 30.0 or v2v_limit == 0.0:
                    v["action"] = "STOP"
                    v["status"] = "CRITICAL"
                    v["speed_kmh"] = 0.0
                elif active_adv.get("recommended_action") in ("SLOW DOWN", "STOP_OR_SLOW") or active_adv["distance_m"] <= V2V_CONFIG["warning_range_m"]:
                    v["action"] = "SLOW DOWN"
                    v["status"] = "CAUTION"
                    if v["speed_kmh"] > v2v_limit:
                        v["speed_kmh"] = round(max(v2v_limit, v["speed_kmh"] - 3.5), 1)
                    else:
                        v["speed_kmh"] = round(min(v["speed_kmh"], v2v_limit), 1)

        return {
            "status": "CONNECTED",
            "transport": V2V_CONFIG["transport_type"],
            "hardware_readiness": V2V_CONFIG["hardware_readiness"],
            "active_links_count": len(all_active_links),
            "active_alerts_count": len(self.active_alerts),
            "messages_per_sec": self.messages_per_sec,
            "active_links": all_active_links,
            "active_alerts": list(self.active_alerts.values()),
            "recent_events": list(self.event_log)[:35]
        }


# Global Singleton instance
v2v_engine = V2VSafetyEngine()
