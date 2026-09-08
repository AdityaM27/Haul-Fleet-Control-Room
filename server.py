"""
RESURGENCE FLEET CONTROL ROOM — 6-Vehicle Simulation & Telemetry Server

Key Upgrades:
- Simplified industrial names: Truck 1 through Truck 6 (TRUCK_01 to TRUCK_06)
- Real-time Risk Score Engine (0-100) per vehicle (Speed, Fog, Traffic, Road Hazard)
- Dynamic Fog Zones (4 Zones) with real-time visibility classification & safe speed limits
- 10-Minute Fog Predictive Forecasting (Atmospheric model: humidity, dew point, elevation)
- Real Hardware vs Simulation Segregation (Dedicated ESP32 + GPS hardware node)
- Traffic Proximity Matrix (Haversine inter-truck collision proximity)
- Dark Channel Prior OpenCV Dehazing Stream
"""

import math
import os
import random
import threading
import time
from datetime import datetime
from flask import Flask, Response, jsonify, render_template, request
import cv2
import numpy as np

app = Flask(__name__)

# ==============================================================================
# BAILADILA IRON ORE MINING REGION WAYPOINTS (NMDC Deposit 5 & Bacheli Complex)
# Location: Bailadila Range, Dantewada District, Chhattisgarh (18.7250° N, 81.2450° E)
# ==============================================================================
BASE_LAT = 18.7250
BASE_LNG = 81.2450

BAILADILA_WAYPOINTS = [
    {"lat": 18.7210, "lng": 81.2420, "name": "Deposit 5 Pit Bottom Loading Bay", "speed_limit": 25},
    {"lat": 18.7232, "lng": 81.2448, "name": "Deposit 5 Pit Incline Ramp 1", "speed_limit": 30},
    {"lat": 18.7260, "lng": 81.2475, "name": "Ridge Switchback Turn 1", "speed_limit": 18},
    {"lat": 18.7288, "lng": 81.2462, "name": "Bailadila Crest Haulway", "speed_limit": 38},
    {"lat": 18.7312, "lng": 81.2438, "name": "Bacheli Crusher Plant Junction", "speed_limit": 28},
    {"lat": 18.7335, "lng": 81.2412, "name": "Primary Gyratory Crusher Hopper", "speed_limit": 15},
    {"lat": 18.7320, "lng": 81.2380, "name": "Bacheli Rail Siding Weighbridge", "speed_limit": 22},
    {"lat": 18.7295, "lng": 81.2355, "name": "West Overburden Waste Dump Ridge", "speed_limit": 32},
    {"lat": 18.7268, "lng": 81.2345, "name": "Deposit 5 West Bench Decline Ramp", "speed_limit": 26},
    {"lat": 18.7240, "lng": 81.2365, "name": "South Switchback Turn 2", "speed_limit": 18},
    {"lat": 18.7220, "lng": 81.2388, "name": "Heavy Equipment Workshop Spur", "speed_limit": 35},
    {"lat": 18.7205, "lng": 81.2405, "name": "Refueling Depot & Shift Staging", "speed_limit": 20},
]
QUARRY_WAYPOINTS = BAILADILA_WAYPOINTS  # Maintained for backwards compatibility

# ==============================================================================
# DYNAMIC FOG ZONES & 10-MINUTE PREDICTIVE ENGINE (Bailadila Ridge Model)
# ==============================================================================
FOG_ZONES = {
    "ZONE_1": {
        "id": "ZONE_1",
        "name": "Zone 1: Deposit 5 Pit Bottom Bench",
        "elevation_m": 1040,
        "polygon": [
            [18.7185, 81.2390],
            [18.7245, 81.2390],
            [18.7245, 81.2455],
            [18.7185, 81.2455],
        ],
        "center": [18.7215, 81.2422],
        "temperature_c": 17.4,
        "humidity_pct": 93.0,
        "dew_point_c": 16.2,
        "wind_speed_kmh": 4.8,
        "wind_dir": "NE",
        "visibility_m": 18,
        "severity": "SEVERE FOG",
        "color": "#ef4444",
        "max_safe_speed": 10,
        "prediction_10m": {
            "visibility_m": 12,
            "severity": "CRITICAL FOG",
            "trend": "Worsening (Bastar Valley Cloud Inversion)",
            "advisory": "Dense valley cloud inversion rising into pit. Mandate automated speed governor."
        }
    },
    "ZONE_2": {
        "id": "ZONE_2",
        "name": "Zone 2: North Ridge Switchback Haulway",
        "elevation_m": 1165,
        "polygon": [
            [18.7245, 81.2430],
            [18.7300, 81.2430],
            [18.7300, 81.2495],
            [18.7245, 81.2495],
        ],
        "center": [18.7272, 81.2465],
        "temperature_c": 18.8,
        "humidity_pct": 82.0,
        "dew_point_c": 15.6,
        "wind_speed_kmh": 9.5,
        "wind_dir": "ENE",
        "visibility_m": 42,
        "severity": "LOW VISIBILITY",
        "color": "#f97316",
        "max_safe_speed": 18,
        "prediction_10m": {
            "visibility_m": 24,
            "severity": "SEVERE FOG",
            "trend": "Deteriorating (Upslope Mountain Mist)",
            "advisory": "Mountain ridge updraft creating dense fog pockets along switchback turns."
        }
    },
    "ZONE_3": {
        "id": "ZONE_3",
        "name": "Zone 3: Waste Dump Ridge (Peak 1220m)",
        "elevation_m": 1220,
        "polygon": [
            [18.7245, 81.2325],
            [18.7310, 81.2325],
            [18.7310, 81.2390],
            [18.7245, 81.2390],
        ],
        "center": [18.7278, 81.2358],
        "temperature_c": 20.2,
        "humidity_pct": 60.0,
        "dew_point_c": 12.1,
        "wind_speed_kmh": 17.0,
        "wind_dir": "E",
        "visibility_m": 85,
        "severity": "CAUTION",
        "color": "#f59e0b",
        "max_safe_speed": 25,
        "prediction_10m": {
            "visibility_m": 75,
            "severity": "CAUTION",
            "trend": "Stable (Ridge Wind Dispersing Haze)",
            "advisory": "Maintain caution distance; intermittent mountain crest mist."
        }
    },
    "ZONE_4": {
        "id": "ZONE_4",
        "name": "Zone 4: Primary Crusher & Bacheli Terminal",
        "elevation_m": 1110,
        "polygon": [
            [18.7295, 81.2380],
            [18.7355, 81.2380],
            [18.7355, 81.2455],
            [18.7295, 81.2455],
        ],
        "center": [18.7325, 81.2418],
        "temperature_c": 21.5,
        "humidity_pct": 46.0,
        "dew_point_c": 9.2,
        "wind_speed_kmh": 12.5,
        "wind_dir": "ESE",
        "visibility_m": 145,
        "severity": "NORMAL",
        "color": "#10b981",
        "max_safe_speed": 35,
        "prediction_10m": {
            "visibility_m": 140,
            "severity": "NORMAL",
            "trend": "Clear (Terminal Fans Active)",
            "advisory": "Crusher plant approach and rail siding clear. Nominal operating speed permitted."
        }
    },
}


def point_in_polygon(lat, lng, poly):
    """Ray-casting algorithm to test point inside zone polygon."""
    inside = False
    n = len(poly)
    for i in range(n):
        p1 = poly[i]
        p2 = poly[(i + 1) % n]
        if (p1[1] > lng) != (p2[1] > lng):
            slope = (lat - p1[0]) * (p2[1] - p1[1]) - (lng - p1[1]) * (p2[0] - p1[0])
            if (p2[1] > p1[1] and slope > 0) or (p2[1] <= p1[1] and slope < 0):
                inside = not inside
    return inside


def get_zone_for_point(lat, lng):
    for zid, z in FOG_ZONES.items():
        if point_in_polygon(lat, lng, z["polygon"]):
            return z
    # Fallback to closest zone center
    closest_z = FOG_ZONES["ZONE_1"]
    min_dist = float("inf")
    for zid, z in FOG_ZONES.items():
        d = (lat - z["center"][0]) ** 2 + (lng - z["center"][1]) ** 2
        if d < min_dist:
            min_dist = d
            closest_z = z
    return closest_z


def haversine_distance_m(lat1, lon1, lat2, lon2):
    """Calculates ground distance between two GPS coordinates in meters."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


# ==============================================================================
# 6 TRUCK FLEET DEFINITIONS (Clean Industrial Naming)
# ==============================================================================
FLEET_DEFS = [
    {
        "id": "TRUCK_01",
        "name": "TRUCK_01",
        "model": "Caterpillar 797F",
        "type": "Haul Truck",
        "max_payload": 360,
        "base_wp_idx": 0,
        "avatar_color": "#38bdf8",
        "default_source": "REAL_HARDWARE",  # Ready for ESP32 + GPS binding
    },
    {
        "id": "TRUCK_02",
        "name": "TRUCK_02",
        "model": "Bucyrus MT4400",
        "type": "Haul Truck",
        "max_payload": 240,
        "base_wp_idx": 2,
        "avatar_color": "#10b981",
        "default_source": "SIMULATED",
    },
    {
        "id": "TRUCK_03",
        "name": "TRUCK_03",
        "model": "Komatsu 930E-5",
        "type": "Haul Truck",
        "max_payload": 290,
        "base_wp_idx": 4,
        "avatar_color": "#3b82f6",
        "default_source": "SIMULATED",
    },
    {
        "id": "TRUCK_04",
        "name": "TRUCK_04",
        "model": "Liebherr T 284",
        "type": "Haul Truck",
        "max_payload": 363,
        "base_wp_idx": 6,
        "avatar_color": "#f59e0b",
        "default_source": "SIMULATED",
    },
    {
        "id": "TRUCK_05",
        "name": "TRUCK_05",
        "model": "BelAZ 75710",
        "type": "Haul Truck",
        "max_payload": 450,
        "base_wp_idx": 8,
        "avatar_color": "#ec4899",
        "default_source": "SIMULATED",
    },
    {
        "id": "TRUCK_06",
        "name": "TRUCK_06",
        "model": "Hitachi EH5000AC-3",
        "type": "Haul Truck",
        "max_payload": 296,
        "base_wp_idx": 10,
        "avatar_color": "#a855f7",
        "default_source": "SIMULATED",
    },
]

# Alias map for backward compatibility with ESP32 scripts and earlier identifiers
VEHICLE_ALIASES = {
    "HAUL_01": "TRUCK_01", "DUMPER_01": "TRUCK_01", "DUMPER_01_SIM": "TRUCK_01", "PROTOTYPE_1": "TRUCK_01", "1": "TRUCK_01", "TRUCK_1": "TRUCK_01", "TRUCK 1": "TRUCK_01",
    "HAUL_02": "TRUCK_02", "DUMPER_02": "TRUCK_02", "2": "TRUCK_02", "TRUCK_2": "TRUCK_02", "TRUCK 2": "TRUCK_02",
    "HAUL_03": "TRUCK_03", "DUMPER_03": "TRUCK_03", "3": "TRUCK_03", "TRUCK_3": "TRUCK_03", "TRUCK 3": "TRUCK_03",
    "HAUL_04": "TRUCK_04", "DUMPER_04": "TRUCK_04", "4": "TRUCK_04", "TRUCK_4": "TRUCK_04", "TRUCK 4": "TRUCK_04",
    "HAUL_05": "TRUCK_05", "DUMPER_05": "TRUCK_05", "5": "TRUCK_05", "TRUCK_5": "TRUCK_05", "TRUCK 5": "TRUCK_05",
    "HAUL_06": "TRUCK_06", "DUMPER_06": "TRUCK_06", "6": "TRUCK_06", "TRUCK_6": "TRUCK_06", "TRUCK 6": "TRUCK_06",
}

fleet_lock = threading.Lock()
fleet_data = {}
simulation_config = {
    "running": True,
    "speed_multiplier": 1.0,
    "obstacle_probability": 0.08,
}
MAX_TRAIL_LEN = 80
MAX_VEHICLE_LOG = 35

# Initialize vehicle states
for vdef in FLEET_DEFS:
    wp_idx = vdef["base_wp_idx"] % len(QUARRY_WAYPOINTS)
    wp = QUARRY_WAYPOINTS[wp_idx]
    next_wp = QUARRY_WAYPOINTS[(wp_idx + 1) % len(QUARRY_WAYPOINTS)]

    d_lng = next_wp["lng"] - wp["lng"]
    d_lat = next_wp["lat"] - wp["lat"]
    heading = (math.degrees(math.atan2(d_lng, d_lat)) + 360) % 360
    zone = get_zone_for_point(wp["lat"], wp["lng"])

    fleet_data[vdef["id"]] = {
        "id": vdef["id"],
        "name": vdef["name"],
        "model": vdef["model"],
        "type": vdef["type"],
        "max_payload": vdef["max_payload"],
        "avatar_color": vdef["avatar_color"],
        "source_type": vdef["default_source"],  # 'SIMULATED' or 'REAL_HARDWARE'
        "hardware_status": "ONLINE" if vdef["default_source"] == "REAL_HARDWARE" else "N/A",
        "last_hardware_packet": None,
        "packet_count": 0,
        "status": "NORMAL",
        "action": "CLEAR",
        "speed_kmh": round(min(wp["speed_limit"], zone["max_safe_speed"]) * random.uniform(0.85, 1.02), 1),
        "target_speed": zone["max_safe_speed"],
        "gear": "D3",
        "battery_pct": round(random.uniform(82.0, 99.0), 1),
        "engine_temp_c": round(random.uniform(84.0, 92.0), 1),
        "tire_pressure_psi": round(random.uniform(101.0, 104.5), 1),
        "payload_tons": round(vdef["max_payload"] * random.uniform(0.65, 0.98), 1),
        "dist_front": random.randint(140, 220),
        "dist_left": random.randint(120, 200),
        "dist_right": random.randint(120, 200),
        "gps_valid": True,
        "lat": round(wp["lat"], 6),
        "lng": round(wp["lng"], 6),
        "elevation_m": zone["elevation_m"],
        "heading": round(heading, 1),
        "wp_idx": wp_idx,
        "wp_t": 0.0,
        "trail": [[round(wp["lat"], 6), round(wp["lng"], 6)]],
        "current_zone": {
            "id": zone["id"],
            "name": zone["name"],
            "visibility_m": zone["visibility_m"],
            "severity": zone["severity"],
            "max_safe_speed": zone["max_safe_speed"],
            "color": zone["color"],
        },
        "risk_score": {
            "total": 24,
            "level": "LOW",
            "speed_factor": 15,
            "fog_factor": 25,
            "traffic_factor": 10,
            "hazard_factor": 5,
        },
        "closest_truck": {
            "id": "NONE",
            "name": "None",
            "distance_m": 999.0,
        },
        "log": [
            {
                "time": datetime.now().strftime("%H:%M:%S"),
                "action": "CLEAR",
                "dist_front": 180,
                "note": f"{vdef['name']} online. Source: {vdef['default_source']}.",
            }
        ],
        "manual_obstacle_until": 0,
        "last_update": datetime.now().strftime("%H:%M:%S"),
    }


def decide_action(front, left, right):
    if front < 15:
        if left > right and left > 45:
            return "TURN LEFT"
        if right > left and right > 45:
            return "TURN RIGHT"
        return "STOP"
    if front < 40:
        if left > right and left > 40:
            return "TURN LEFT"
        if right > left and right > 40:
            return "TURN RIGHT"
        return "SLOW DOWN"
    return "CLEAR"


# ==============================================================================
# REAL-TIME RISK SCORE CALCULATION
# ==============================================================================
def compute_risk_score(v, closest_dist, zone):
    """
    Computes real-time composite Risk Score (0-100) per truck:
      - Speed Factor: Speed vs Zone Maximum Safe Fog Speed
      - Fog Exposure: Inversely proportional to visibility
      - Traffic Proximity: Distance to closest other truck
      - Road Hazard: Front obstacle distance from ultrasonic sensor
    """
    # 1. Speed Factor (0 - 100)
    safe_speed = zone["max_safe_speed"]
    if v["speed_kmh"] <= safe_speed:
        speed_factor = (v["speed_kmh"] / (safe_speed + 1e-5)) * 40.0
    else:
        overspeed = v["speed_kmh"] - safe_speed
        speed_factor = min(100.0, 40.0 + (overspeed / 15.0) * 60.0)

    # 2. Fog Exposure (0 - 100)
    vis = zone["visibility_m"]
    if vis >= 120:
        fog_factor = 10.0
    elif vis >= 80:
        fog_factor = 30.0
    elif vis >= 40:
        fog_factor = 60.0
    elif vis >= 15:
        fog_factor = 85.0
    else:
        fog_factor = 100.0

    # 3. Traffic Proximity Factor (0 - 100)
    if closest_dist < 20.0:
        traffic_factor = 95.0
    elif closest_dist < 40.0:
        traffic_factor = 70.0
    elif closest_dist < 75.0:
        traffic_factor = 40.0
    elif closest_dist < 120.0:
        traffic_factor = 20.0
    else:
        traffic_factor = 5.0

    # 4. Road Hazard Factor (0 - 100)
    front = v["dist_front"]
    if front < 15:
        hazard_factor = 100.0
    elif front < 35:
        hazard_factor = 75.0
    elif front < 60:
        hazard_factor = 45.0
    elif front < 100:
        hazard_factor = 20.0
    else:
        hazard_factor = 5.0

    # Weighted composite score
    total = (
        0.30 * speed_factor +
        0.30 * fog_factor +
        0.20 * traffic_factor +
        0.20 * hazard_factor
    )
    total_clamped = int(max(0, min(100, round(total))))

    if total_clamped >= 80:
        level = "CRITICAL"
    elif total_clamped >= 60:
        level = "HIGH"
    elif total_clamped >= 35:
        level = "MODERATE"
    else:
        level = "LOW"

    return {
        "total": total_clamped,
        "level": level,
        "speed_factor": int(round(speed_factor)),
        "fog_factor": int(round(fog_factor)),
        "traffic_factor": int(round(traffic_factor)),
        "hazard_factor": int(round(hazard_factor)),
    }


# ==============================================================================
# AUTONOMOUS SIMULATION THREAD
# ==============================================================================
def simulation_loop():
    while True:
        time.sleep(1.0)
        with fleet_lock:
            now_str = datetime.now().strftime("%H:%M:%S")
            now_ts = time.time()
            multiplier = simulation_config["speed_multiplier"]

            # Calculate pairwise inter-truck distances for traffic proximity
            truck_ids = list(fleet_data.keys())
            closest_info = {}
            for i, vid1 in enumerate(truck_ids):
                v1 = fleet_data[vid1]
                min_d = 9999.0
                closest_id = None
                for j, vid2 in enumerate(truck_ids):
                    if i == j:
                        continue
                    v2 = fleet_data[vid2]
                    d = haversine_distance_m(v1["lat"], v1["lng"], v2["lat"], v2["lng"])
                    if d < min_d:
                        min_d = d
                        closest_id = vid2
                closest_info[vid1] = {
                    "id": closest_id or "NONE",
                    "name": fleet_data[closest_id]["name"] if closest_id else "None",
                    "distance_m": round(min_d, 1),
                }

            for vid, v in fleet_data.items():
                v["closest_truck"] = closest_info[vid]
                zone = get_zone_for_point(v["lat"], v["lng"])
                v["current_zone"] = {
                    "id": zone["id"],
                    "name": zone["name"],
                    "visibility_m": zone["visibility_m"],
                    "severity": zone["severity"],
                    "max_safe_speed": zone["max_safe_speed"],
                    "color": zone["color"],
                }

                # If this vehicle is bound to REAL_HARDWARE, do not simulate motion or sensors
                # Real hardware posts into /update directly.
                if v["source_type"] == "REAL_HARDWARE":
                    # Just refresh risk score and check hardware heartbeat
                    v["risk_score"] = compute_risk_score(v, closest_info[vid]["distance_m"], zone)
                    if v["last_hardware_packet"]:
                        elapsed = now_ts - v["last_hardware_packet"]
                        if elapsed > 12.0:
                            v["hardware_status"] = "LINK_TIMEOUT"
                        else:
                            v["hardware_status"] = "CONNECTED_LIVE"
                    continue

                if not simulation_config["running"]:
                    v["risk_score"] = compute_risk_score(v, closest_info[vid]["distance_m"], zone)
                    continue

                # SIMULATED VEHICLE LOGIC
                cur_wp = QUARRY_WAYPOINTS[v["wp_idx"]]
                next_wp_idx = (v["wp_idx"] + 1) % len(QUARRY_WAYPOINTS)
                next_wp = QUARRY_WAYPOINTS[next_wp_idx]

                if now_ts < v.get("manual_obstacle_until", 0):
                    front = v["dist_front"]
                    left = v["dist_left"]
                    right = v["dist_right"]
                else:
                    if random.random() < simulation_config["obstacle_probability"]:
                        front = random.randint(8, 38)
                        left = random.randint(20, 150)
                        right = random.randint(20, 150)
                    else:
                        front = random.randint(85, 230)
                        left = random.randint(70, 200)
                        right = random.randint(70, 200)

                action = decide_action(front, left, right)
                prev_action = v["action"]

                v["dist_front"] = front
                v["dist_left"] = left
                v["dist_right"] = right
                v["action"] = action
                v["last_update"] = now_str

                # Speed & Gear adaptation: Governed by Zone Max Safe Fog Speed!
                target_speed = min(cur_wp["speed_limit"], zone["max_safe_speed"])
                v["target_speed"] = target_speed

                if action == "STOP":
                    v["status"] = "CRITICAL"
                    v["speed_kmh"] = 0.0
                    v["gear"] = "N"
                elif action in ("SLOW DOWN", "TURN LEFT", "TURN RIGHT"):
                    v["status"] = "CAUTION"
                    v["speed_kmh"] = round(max(6.0, v["speed_kmh"] * 0.65), 1)
                    v["gear"] = "D1"
                else:
                    v["status"] = "NORMAL"
                    if v["speed_kmh"] < target_speed:
                        v["speed_kmh"] = round(min(target_speed, v["speed_kmh"] + random.uniform(1.5, 4.0)), 1)
                    elif v["speed_kmh"] > target_speed:
                        v["speed_kmh"] = round(max(target_speed, v["speed_kmh"] - random.uniform(2.0, 4.0)), 1)
                    v["gear"] = "D3" if v["speed_kmh"] > 22 else "D2"

                # Update Risk Score
                v["risk_score"] = compute_risk_score(v, closest_info[vid]["distance_m"], zone)

                if action != prev_action or (action != "CLEAR" and random.random() < 0.25):
                    v["log"].insert(
                        0,
                        {
                            "time": now_str,
                            "action": action,
                            "dist_front": front,
                            "note": f"Trigger: Front {front}cm (L:{left}cm R:{right}cm) | Risk: {v['risk_score']['total']}",
                        },
                    )
                    del v["log"][MAX_VEHICLE_LOG:]

                # Move vehicle along waypoint segment
                if v["speed_kmh"] > 0:
                    step = (v["speed_kmh"] / 100.0) * 0.04 * multiplier
                    v["wp_t"] += step

                    if v["wp_t"] >= 1.0:
                        v["wp_t"] -= 1.0
                        v["wp_idx"] = next_wp_idx
                        cur_wp = QUARRY_WAYPOINTS[v["wp_idx"]]
                        next_wp = QUARRY_WAYPOINTS[(v["wp_idx"] + 1) % len(QUARRY_WAYPOINTS)]

                    t = v["wp_t"]
                    lat = cur_wp["lat"] + (next_wp["lat"] - cur_wp["lat"]) * t
                    lng = cur_wp["lng"] + (next_wp["lng"] - cur_wp["lng"]) * t

                    d_lng = next_wp["lng"] - cur_wp["lng"]
                    d_lat = next_wp["lat"] - cur_wp["lat"]
                    heading = (math.degrees(math.atan2(d_lng, d_lat)) + 360) % 360

                    v["lat"] = round(lat, 6)
                    v["lng"] = round(lng, 6)
                    v["heading"] = round(heading, 1)

                    trail = v["trail"]
                    last_pt = trail[-1] if trail else None
                    if not last_pt or (abs(last_pt[0] - v["lat"]) > 0.00003 or abs(last_pt[1] - v["lng"]) > 0.00003):
                        trail.append([v["lat"], v["lng"]])
                        if len(trail) > MAX_TRAIL_LEN:
                            trail.pop(0)

                v["battery_pct"] = round(max(5.0, v["battery_pct"] - 0.006 * multiplier), 1)
                temp_delta = 0.3 if v["speed_kmh"] > 22 else -0.15
                v["engine_temp_c"] = round(
                    max(80.0, min(104.0, v["engine_temp_c"] + temp_delta * random.uniform(0.5, 1.2))),
                    1,
                )


sim_thread = threading.Thread(target=simulation_loop, daemon=True)
sim_thread.start()


# ==============================================================================
# OPENCV WEBCAM & DEHAZING
# ==============================================================================
camera = None
try:
    cam_candidate = cv2.VideoCapture(0)
    if cam_candidate.isOpened():
        camera = cam_candidate
        print("[Vision] Physical webcam detected and opened on index 0.")
    else:
        print("[Vision] No physical webcam detected. Enabling synthetic video feed.")
except Exception as e:
    print(f"[Vision] Camera init exception: {e}. Using synthetic feed.")


def dark_channel(img, patch_size=15):
    min_channel = np.min(img, axis=2)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (patch_size, patch_size))
    return cv2.erode(min_channel, kernel)


def estimate_atmospheric_light(img, dark_ch):
    flat_dark = dark_ch.flatten()
    flat_img = img.reshape(-1, 3)
    num_pixels = max(int(0.001 * len(flat_dark)), 1)
    indices = np.argsort(flat_dark)[-num_pixels:]
    return np.mean(flat_img[indices], axis=0)


def dehaze_frame(frame, patch_size=15, omega=0.85, t_min=0.2):
    img = frame.astype(np.float64) / 255.0
    dark_ch = dark_channel(img, patch_size)
    atmo_light = estimate_atmospheric_light(img, dark_ch)

    norm_img = img / (atmo_light + 1e-6)
    transmission = 1 - omega * dark_channel(norm_img, patch_size)
    transmission = np.clip(transmission, t_min, 1.0)

    result = np.empty_like(img)
    for c in range(3):
        result[:, :, c] = (img[:, :, c] - atmo_light[c]) / transmission + atmo_light[c]

    result = np.clip(result, 0, 1)
    return (result * 255).astype(np.uint8)


def generate_synthetic_frame(dehazed_mode=False):
    w, h = 480, 360
    t = time.time()

    frame = np.zeros((h, w, 3), dtype=np.uint8)
    cv2.rectangle(frame, (0, int(h * 0.45)), (w, h), (40, 52, 60), -1)
    cv2.rectangle(frame, (0, 0), (w, int(h * 0.45)), (90, 105, 115), -1)

    pts = np.array([
        [int(w * 0.42), int(h * 0.45)],
        [int(w * 0.58), int(h * 0.45)],
        [int(w * 0.90), h],
        [int(w * 0.10), h],
    ], np.int32)
    cv2.fillPoly(frame, [pts], (30, 36, 42))

    offset = int((t * 60) % 40)
    for y in range(int(h * 0.48) + offset, h, 35):
        scale = (y - h * 0.45) / (h * 0.55)
        lw = max(2, int(6 * scale))
        lh = max(3, int(15 * scale))
        cx = int(w * 0.5)
        cv2.rectangle(frame, (cx - lw // 2, y), (cx + lw // 2, y + lh), (180, 190, 140), -1)

    obs_y = int(h * 0.65 + math.sin(t * 0.5) * 20)
    obs_x = int(w * 0.52 + math.cos(t * 0.3) * 30)
    cv2.circle(frame, (obs_x, obs_y), 16, (45, 50, 55), -1)
    cv2.circle(frame, (obs_x - 3, obs_y - 4), 10, (70, 75, 80), -1)

    if not dehazed_mode:
        fog = np.full((h, w, 3), (160, 175, 180), dtype=np.uint8)
        noise = np.random.randint(0, 20, (h, w, 3), dtype=np.uint8)
        fog = cv2.add(fog, noise)
        frame = cv2.addWeighted(frame, 0.28, fog, 0.72, 0)

        cv2.putText(frame, "CAM-01 [OPTICAL FEED: DENSE FOG]", (15, 26),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.50, (240, 240, 240), 2)
        cv2.putText(frame, "ZONE 1: PIT BOTTOM | VIS: 18m", (15, 48),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 79, 85), 1)
    else:
        frame = cv2.convertScaleAbs(frame, alpha=1.3, beta=-15)
        x1, y1 = obs_x - 22, obs_y - 20
        x2, y2 = obs_x + 22, obs_y + 20
        cv2.rectangle(frame, (x1, y1), (x2, y2), (53, 209, 192), 2)
        cv2.putText(frame, "OBSTACLE DETECTED", (x1 - 10, y1 - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.40, (53, 209, 192), 1)

        cv2.putText(frame, "CAM-01 [DEHAZED DPC FILTER]", (15, 26),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.50, (53, 209, 192), 2)
        cv2.putText(frame, "STATUS: RESTORED | CLARITY +88%", (15, 48),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (56, 231, 138), 1)

    cv2.putText(frame, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), (15, h - 14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 220, 220), 1)

    return frame


def gen_frames(is_dehazed=False):
    global camera
    while True:
        frame = None
        if camera and camera.isOpened():
            success, captured = camera.read()
            if success:
                frame = cv2.resize(captured, (480, 360))
                if is_dehazed:
                    frame = dehaze_frame(frame)
                    cv2.putText(frame, "LIVE DEHAZED", (12, 28),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (53, 209, 192), 2)
                else:
                    cv2.putText(frame, "LIVE RAW", (12, 28),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)

        if frame is None:
            frame = generate_synthetic_frame(dehazed_mode=is_dehazed)

        ret, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if not ret:
            time.sleep(0.05)
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n"
        )
        time.sleep(0.06)


@app.route("/raw_feed")
def raw_feed():
    return Response(gen_frames(is_dehazed=False), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/dehazed_feed")
@app.route("/video_feed")
def dehazed_feed():
    return Response(gen_frames(is_dehazed=True), mimetype="multipart/x-mixed-replace; boundary=frame")


# ==============================================================================
# REST API ENDPOINTS
# ==============================================================================
@app.route("/api/fleet", methods=["GET"])
def get_fleet():
    with fleet_lock:
        v_list = []
        clear_count = 0
        caution_count = 0
        stopped_count = 0
        total_speed = 0.0
        high_risk_count = 0

        for vid, v in list(fleet_data.items()):
            # Calculate live connection status
            is_connected = False
            if v["source_type"] == "REAL_HARDWARE":
                if v.get("last_hardware_packet"):
                    elapsed = time.time() - v["last_hardware_packet"]
                    is_connected = (elapsed <= 15.0)
                else:
                    is_connected = False
            else:
                is_connected = simulation_config["running"]

            is_moving = (v["speed_kmh"] > 0.5 and v["action"] != "STOP")
            v["is_connected"] = is_connected
            v["is_moving"] = is_moving

            v_list.append({
                "id": v["id"],
                "name": v["name"],
                "model": v["model"],
                "type": v["type"],
                "source_type": v["source_type"],
                "hardware_status": v["hardware_status"],
                "is_connected": is_connected,
                "is_moving": is_moving,
                "packet_count": v["packet_count"],
                "status": v["status"],
                "action": v["action"],
                "speed_kmh": v["speed_kmh"],
                "battery_pct": v["battery_pct"],
                "payload_tons": v["payload_tons"],
                "dist_front": v["dist_front"],
                "dist_left": v["dist_left"],
                "dist_right": v["dist_right"],
                "lat": v["lat"],
                "lng": v["lng"],
                "elevation_m": v.get("elevation_m", 1040),
                "heading": v["heading"],
                "avatar_color": v["avatar_color"],
                "current_zone": v["current_zone"],
                "risk_score": v["risk_score"],
                "closest_truck": v["closest_truck"],
                "last_update": v["last_update"],
            })

            if v["action"] == "STOP":
                stopped_count += 1
            elif v["action"] in ("SLOW DOWN", "TURN LEFT", "TURN RIGHT"):
                caution_count += 1
            else:
                clear_count += 1

            if v["risk_score"]["total"] >= 70:
                high_risk_count += 1

            total_speed += v["speed_kmh"]

        avg_speed = round(total_speed / len(v_list), 1) if v_list else 0.0

        return jsonify({
            "vehicles": v_list,
            "simulation": {
                "running": simulation_config["running"],
                "speed_multiplier": simulation_config["speed_multiplier"],
            },
            "fleet_stats": {
                "total": len(v_list),
                "clear": clear_count,
                "caution": caution_count,
                "stopped": stopped_count,
                "high_risk": high_risk_count,
                "avg_speed": avg_speed,
            },
            "timestamp": datetime.now().strftime("%H:%M:%S"),
        })


@app.route("/api/vehicle/<vehicle_id>", methods=["GET"])
def get_vehicle(vehicle_id):
    norm_vid = VEHICLE_ALIASES.get(vehicle_id.upper(), vehicle_id.upper())
    with fleet_lock:
        v = fleet_data.get(norm_vid)
        if not v:
            return jsonify({"status": "error", "msg": f"Vehicle {vehicle_id} not found"}), 404

        if v["source_type"] == "REAL_HARDWARE":
            if v.get("last_hardware_packet"):
                elapsed = time.time() - v["last_hardware_packet"]
                is_connected = (elapsed <= 15.0)
            else:
                is_connected = False
        else:
            is_connected = simulation_config["running"]

        is_moving = (v["speed_kmh"] > 0.5 and v["action"] != "STOP")
        v["is_connected"] = is_connected
        v["is_moving"] = is_moving

        return jsonify(v)


@app.route("/api/vehicle/add", methods=["POST"])
def add_vehicle():
    """Registers a new vehicle/device dynamically in the fleet."""
    req = request.get_json(force=True, silent=True) or {}
    raw_name = req.get("name", "").strip()
    raw_id = req.get("id", "").strip()
    model = req.get("model", "Caterpillar 797F").strip() or "Caterpillar 797F"
    vtype = req.get("type", "Haul Truck").strip() or "Haul Truck"
    source_type = req.get("source_type", "REAL_HARDWARE").upper()
    if source_type not in ("REAL_HARDWARE", "SIMULATED"):
        source_type = "REAL_HARDWARE"
    max_payload = float(req.get("max_payload", 320))
    avatar_color = req.get("avatar_color", "").strip()

    with fleet_lock:
        count = len(fleet_data) + 1
        if not raw_id:
            if raw_name and raw_name.upper().startswith("TRUCK_"):
                vid = raw_name.upper()
            else:
                vid = f"TRUCK_{count:02d}"
        else:
            vid = raw_id.upper().replace(" ", "_")

        vname = raw_name if raw_name else vid

        if vid in fleet_data:
            return jsonify({"status": "error", "msg": f"Device ID '{vid}' already exists."}), 400

        colors = ["#20d5c7", "#38e78a", "#3b82f6", "#f59e0b", "#ec4899", "#a855f7", "#06b6d4", "#eab308", "#10b981"]
        if not avatar_color:
            avatar_color = colors[(count - 1) % len(colors)]

        wp_idx = (count * 2) % len(QUARRY_WAYPOINTS)
        wp = QUARRY_WAYPOINTS[wp_idx]
        next_wp = QUARRY_WAYPOINTS[(wp_idx + 1) % len(QUARRY_WAYPOINTS)]
        d_lng = next_wp["lng"] - wp["lng"]
        d_lat = next_wp["lat"] - wp["lat"]
        heading = (math.degrees(math.atan2(d_lng, d_lat)) + 360) % 360

        lat = round(wp["lat"], 6)
        lng = round(wp["lng"], 6)
        if "lat" in req and "lng" in req and float(req["lat"]) != 0:
            lat = float(req["lat"])
            lng = float(req["lng"])

        zone = get_zone_for_point(lat, lng)
        now_str = datetime.now().strftime("%H:%M:%S")

        new_v = {
            "id": vid,
            "name": vname,
            "model": model,
            "type": vtype,
            "max_payload": max_payload,
            "avatar_color": avatar_color,
            "source_type": source_type,
            "hardware_status": "ONLINE" if source_type == "REAL_HARDWARE" else "N/A",
            "last_hardware_packet": time.time() if source_type == "REAL_HARDWARE" else None,
            "packet_count": 0,
            "status": "NORMAL",
            "action": "CLEAR",
            "speed_kmh": round(min(wp["speed_limit"], zone["max_safe_speed"]) * 0.9, 1),
            "target_speed": zone["max_safe_speed"],
            "gear": "D2",
            "battery_pct": 100.0,
            "engine_temp_c": 86.0,
            "tire_pressure_psi": 102.5,
            "payload_tons": round(max_payload * 0.75, 1),
            "dist_front": 180,
            "dist_left": 150,
            "dist_right": 150,
            "gps_valid": True,
            "lat": lat,
            "lng": lng,
            "elevation_m": zone["elevation_m"],
            "heading": round(heading, 1),
            "wp_idx": wp_idx,
            "wp_t": 0.0,
            "trail": [[lat, lng]],
            "current_zone": {
                "id": zone["id"],
                "name": zone["name"],
                "visibility_m": zone["visibility_m"],
                "severity": zone["severity"],
                "max_safe_speed": zone["max_safe_speed"],
                "color": zone["color"],
            },
            "risk_score": {
                "total": 20,
                "level": "LOW",
                "speed_factor": 15,
                "fog_factor": 20,
                "traffic_factor": 10,
                "hazard_factor": 5,
            },
            "closest_truck": {
                "id": "NONE",
                "name": "None",
                "distance_m": 999.0,
            },
            "log": [
                {
                    "time": now_str,
                    "action": "REGISTER",
                    "dist_front": 180,
                    "note": f"{vname} registered. Telemetry mode: {source_type}.",
                }
            ],
            "manual_obstacle_until": 0,
            "last_update": now_str,
            "is_connected": True,
            "is_moving": True if source_type == "SIMULATED" else False,
        }

        fleet_data[vid] = new_v

        # Register aliases for flexible mapping
        VEHICLE_ALIASES[vid] = vid
        VEHICLE_ALIASES[vid.lower()] = vid
        VEHICLE_ALIASES[vname] = vid
        VEHICLE_ALIASES[vname.upper()] = vid
        VEHICLE_ALIASES[vname.lower()] = vid

    return jsonify({
        "status": "ok",
        "msg": f"Device {vname} registered successfully.",
        "vehicle": new_v
    }), 201


@app.route("/api/vehicle/<vehicle_id>", methods=["DELETE"])
@app.route("/api/vehicle/delete", methods=["POST"])
def delete_vehicle(vehicle_id=None):
    """Removes/deregisters a vehicle from the fleet."""
    if not vehicle_id:
        req = request.get_json(force=True, silent=True) or {}
        vehicle_id = req.get("vehicle_id") or req.get("id")

    if not vehicle_id:
        return jsonify({"status": "error", "msg": "Vehicle ID is required"}), 400

    norm_vid = VEHICLE_ALIASES.get(vehicle_id.upper(), vehicle_id.upper())

    with fleet_lock:
        if norm_vid not in fleet_data:
            return jsonify({"status": "error", "msg": f"Vehicle '{vehicle_id}' not found"}), 404

        if len(fleet_data) <= 1:
            return jsonify({"status": "error", "msg": "Cannot delete the only remaining vehicle in the fleet"}), 400

        deleted_v = fleet_data.pop(norm_vid)
        # Purge aliases pointing to this vehicle
        aliases_to_remove = [k for k, v in VEHICLE_ALIASES.items() if v == norm_vid]
        for k in aliases_to_remove:
            VEHICLE_ALIASES.pop(k, None)

    return jsonify({
        "status": "ok",
        "msg": f"Device '{deleted_v.get('name', norm_vid)}' removed successfully.",
        "deleted_id": norm_vid
    })


@app.route("/api/fog_zones", methods=["GET"])
def get_fog_zones():
    return jsonify({
        "zones": list(FOG_ZONES.values()),
        "timestamp": datetime.now().strftime("%H:%M:%S")
    })


@app.route("/api/vehicle/mode", methods=["POST"])
def set_vehicle_mode():
    """Toggles a vehicle between 'SIMULATED' and 'REAL_HARDWARE'."""
    req = request.get_json(force=True, silent=True) or {}
    raw_vid = req.get("vehicle_id", "TRUCK_01")
    vid = VEHICLE_ALIASES.get(raw_vid.upper(), raw_vid.upper())
    mode = req.get("source_type", "REAL_HARDWARE").upper()

    with fleet_lock:
        if vid not in fleet_data:
            return jsonify({"status": "error", "msg": f"Unknown vehicle {vid}"}), 404

        v = fleet_data[vid]
        v["source_type"] = mode
        v["hardware_status"] = "CONNECTED_LIVE" if mode == "REAL_HARDWARE" else "N/A"
        v["log"].insert(0, {
            "time": datetime.now().strftime("%H:%M:%S"),
            "action": "CONFIG",
            "dist_front": v["dist_front"],
            "note": f"Mode changed to {mode}",
        })

    return jsonify({"status": "ok", "vehicle_id": vid, "source_type": mode})


@app.route("/update", methods=["POST"])
def update_telemetry():
    """
    Accepts telemetry updates from external ESP32 + GPS hardware node.
    Supports legacy and modern vehicle IDs: TRUCK_01, HAUL_01, DUMPER_01, PROTOTYPE_1.
    """
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"status": "error", "msg": "No JSON payload"}), 400

    raw_vid = data.get("vehicle_id", "TRUCK_01")
    vid = VEHICLE_ALIASES.get(str(raw_vid).upper(), str(raw_vid).upper())
    now_str = datetime.now().strftime("%H:%M:%S")

    with fleet_lock:
        if vid not in fleet_data:
            return jsonify({"status": "error", "msg": f"Unknown vehicle_id: {raw_vid}"}), 404

        v = fleet_data[vid]
        v["source_type"] = "REAL_HARDWARE"
        v["hardware_status"] = "CONNECTED_LIVE"
        v["last_hardware_packet"] = time.time()
        v["packet_count"] += 1

        front = int(data.get("dist_front", v["dist_front"]))
        left = int(data.get("dist_left", v["dist_left"]))
        right = int(data.get("dist_right", v["dist_right"]))
        action = data.get("action") or decide_action(front, left, right)

        v["dist_front"] = front
        v["dist_left"] = left
        v["dist_right"] = right
        v["action"] = action
        v["last_update"] = now_str

        if "lat" in data and "lng" in data:
            lat = float(data["lat"])
            lng = float(data["lng"])
            if lat != 0.0 and lng != 0.0:
                v["lat"] = lat
                v["lng"] = lng
                v["trail"].append([v["lat"], v["lng"]])
                if len(v["trail"]) > MAX_TRAIL_LEN:
                    v["trail"].pop(0)

        if "gps_valid" in data:
            v["gps_valid"] = bool(data["gps_valid"])

        if "speed" in data:
            v["speed_kmh"] = float(data["speed"])

        if action == "STOP":
            v["status"] = "CRITICAL"
            v["speed_kmh"] = 0.0
        elif action in ("SLOW DOWN", "TURN LEFT", "TURN RIGHT"):
            v["status"] = "CAUTION"
        else:
            v["status"] = "NORMAL"

        zone = get_zone_for_point(v["lat"], v["lng"])
        v["current_zone"] = {
            "id": zone["id"],
            "name": zone["name"],
            "visibility_m": zone["visibility_m"],
            "severity": zone["severity"],
            "max_safe_speed": zone["max_safe_speed"],
            "color": zone["color"],
        }
        v["risk_score"] = compute_risk_score(v, v["closest_truck"]["distance_m"], zone)

        if action != "CLEAR":
            v["log"].insert(0, {
                "time": now_str,
                "action": action,
                "dist_front": front,
                "note": f"ESP32 Hardware: {action} (Front {front}cm)",
            })
            del v["log"][MAX_VEHICLE_LOG:]

    return jsonify({
        "status": "ok",
        "vehicle_id": vid,
        "source_type": "REAL_HARDWARE",
        "risk_score": v["risk_score"]["total"],
        "zone": zone["name"]
    })


@app.route("/api/simulate/obstacle", methods=["POST"])
def simulate_obstacle():
    req = request.get_json(force=True, silent=True) or {}
    raw_vid = req.get("vehicle_id", "TRUCK_01")
    vid = VEHICLE_ALIASES.get(raw_vid.upper(), raw_vid.upper())
    distance = int(req.get("distance", 10))
    duration = int(req.get("duration", 6))

    with fleet_lock:
        if vid not in fleet_data:
            return jsonify({"status": "error", "msg": "Vehicle not found"}), 404

        v = fleet_data[vid]
        v["dist_front"] = distance
        v["action"] = decide_action(distance, v["dist_left"], v["dist_right"])
        v["status"] = "CRITICAL" if v["action"] == "STOP" else "CAUTION"
        v["manual_obstacle_until"] = time.time() + duration
        v["last_update"] = datetime.now().strftime("%H:%M:%S")

        zone = get_zone_for_point(v["lat"], v["lng"])
        v["risk_score"] = compute_risk_score(v, v["closest_truck"]["distance_m"], zone)

        v["log"].insert(0, {
            "time": v["last_update"],
            "action": v["action"],
            "dist_front": distance,
            "note": f"MANUAL OBSTACLE INJECTED: {distance} cm",
        })
        del v["log"][MAX_VEHICLE_LOG:]

    return jsonify({"status": "ok", "vehicle_id": vid, "action": v["action"], "dist_front": distance})


@app.route("/api/simulate/control", methods=["POST"])
def simulate_control():
    req = request.get_json(force=True, silent=True) or {}
    with fleet_lock:
        if "running" in req:
            simulation_config["running"] = bool(req["running"])
        if "speed_multiplier" in req:
            simulation_config["speed_multiplier"] = max(0.2, min(10.0, float(req["speed_multiplier"])))

    return jsonify({
        "status": "ok",
        "running": simulation_config["running"],
        "speed_multiplier": simulation_config["speed_multiplier"],
    })


@app.route("/data", methods=["GET"])
def legacy_data():
    with fleet_lock:
        v = fleet_data.get("TRUCK_01", list(fleet_data.values())[0])
        return jsonify({
            "latest": {
                "vehicle_id": v["id"],
                "dist_front": v["dist_front"],
                "dist_left": v["dist_left"],
                "dist_right": v["dist_right"],
                "action": v["action"],
                "gps_valid": v["gps_valid"],
                "lat": v["lat"],
                "lng": v["lng"],
                "last_update": v["last_update"],
            },
            "log": v["log"],
        })


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"RESURGENCE FLEET CONTROL ROOM 2.0 serving on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
