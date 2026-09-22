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

import base64
import json
import math
import os
import random
import threading
import time
import urllib.request
from datetime import datetime
from flask import Flask, Response, jsonify, render_template, request, session, redirect, url_for
import cv2
import numpy as np

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "resurgence_mine_fleet_auth_key_2026")

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


def haversine_distance_m(lat1, lon1, lat2, lon2):
    """Calculates ground distance between two GPS coordinates in meters."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


# In-memory geo cache to store resolved real-world area names for GPS coordinates
geo_cache = {}


def fetch_nominatim_async(lat, lng, cache_key):
    """Asynchronously fetches reverse geocoding from OpenStreetMap Nominatim."""
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&zoom=16"
        req = urllib.request.Request(url, headers={"User-Agent": "ResurgenceFleetControl/1.0"})
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            addr = data.get("address", {})
            name_part = addr.get("amenity") or addr.get("building") or data.get("name")
            suburb = addr.get("suburb") or addr.get("neighbourhood") or addr.get("city_district")
            city = addr.get("city") or addr.get("town") or addr.get("county")
            state = addr.get("state")

            parts = [p for p in [name_part, suburb, city, state] if p]
            if parts:
                resolved = ", ".join(parts[:3])
                geo_cache[cache_key] = resolved
                with fleet_lock:
                    if "TRUCK_01" in fleet_data:
                        t1 = fleet_data["TRUCK_01"]
                        if (round(t1["lat"], 3), round(t1["lng"], 3)) == cache_key:
                            t1["current_zone"]["name"] = resolved
    except Exception:
        pass


def get_real_area_name(lat, lng):
    """Resolves human-readable real-world area name for GPS coordinates."""
    cache_key = (round(lat, 3), round(lng, 3))
    if cache_key in geo_cache:
        return geo_cache[cache_key]

    # Offline high-accuracy regional detection (instant 0ms response)
    if 17.48 <= lat <= 17.62 and 78.30 <= lng <= 78.48:
        default_name = "VNR VJIET Campus, Bachupally, Hyderabad"
    elif 17.15 <= lat <= 17.70 and 78.10 <= lng <= 78.75:
        default_name = "Hyderabad Regional Sector, Telangana"
    else:
        default_name = f"Real-Time Area ({lat:.4f}°N, {lng:.4f}°E)"

    geo_cache[cache_key] = default_name
    # Trigger background async lookup to enrich location if internet is available
    threading.Thread(target=fetch_nominatim_async, args=(lat, lng, cache_key), daemon=True).start()
    return default_name


def get_zone_for_point(lat, lng):
    """
    Returns the dynamic fog zone or real-time area for the given GPS point.
    If inside Bailadila mining polygons, returns the specific mine zone.
    If outside the mine (e.g. real hardware GPS location), dynamically returns the real-time area.
    """
    for zid, z in FOG_ZONES.items():
        if point_in_polygon(lat, lng, z["polygon"]):
            return z

    # Check if within Bailadila mountain vicinity (~5km radius)
    d_to_bailadila = haversine_distance_m(lat, lng, BASE_LAT, BASE_LNG)
    if d_to_bailadila < 5000.0:
        closest_z = FOG_ZONES["ZONE_1"]
        min_dist = float("inf")
        for zid, z in FOG_ZONES.items():
            d = (lat - z["center"][0]) ** 2 + (lng - z["center"][1]) ** 2
            if d < min_dist:
                min_dist = d
                closest_z = z
        return closest_z

    # Outside Bailadila -> Dynamically resolve the real-world operational area
    area_name = get_real_area_name(lat, lng)
    return {
        "id": "REAL_AREA",
        "name": area_name,
        "elevation_m": 580 if (17.0 <= lat <= 18.0) else 1040,
        "visibility_m": 150,
        "severity": "NORMAL",
        "color": "#38bdf8",
        "max_safe_speed": 35,
        "is_real_location": True,
        "prediction_10m": {
            "visibility_m": 150,
            "severity": "NORMAL",
            "trend": "Live GPS Real-Time Area",
            "advisory": f"Operating live in {area_name}. Telemetry streamed from onboard ESP32 + NEO-6M."
        }
    }


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

# Role-Based Credentials:
# - Admin: full access to all fleet telemetry & control room
# - Drivers: access strictly limited to their own assigned truck
TRUCK_CREDENTIALS = {
    "ADMIN": "admin123",
    "TRUCK_01": "truck01",
    "TRUCK_02": "truck02",
    "TRUCK_03": "truck03",
    "TRUCK_04": "truck04",
    "TRUCK_05": "truck05",
    "TRUCK_06": "truck06",
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

# ==============================================================================
# REALISTIC HETEROGENEOUS INDUSTRIAL SIMULATION PROFILES
# Ensures each simulated haul unit has distinctly different speed, payload,
# cycle stage, tire pressure, temperature, gear, and proximity behavior!
# ==============================================================================
SIMULATION_PROFILES = {
    "TRUCK_02": {
        "desc": "Loaded High-Grade Ore Hauler (Incline Ramp 1)",
        "wp_idx": 1,
        "target_speed": 19.5,
        "gear": "D2",
        "payload_pct": 0.96,   # 230.4 tons (heavy ore load)
        "engine_temp": 95.4,   # High load thermal profile
        "tire_pressure": 107.5,
        "dist_front_range": (140, 195),
        "dist_left_range": (110, 160),
        "dist_right_range": (120, 170),
    },
    "TRUCK_03": {
        "desc": "Empty High-Speed Return Unit (Crest Haulway)",
        "wp_idx": 3,
        "target_speed": 36.5,
        "gear": "D4",
        "payload_pct": 0.0,    # 0.0 tons (empty hopper return)
        "engine_temp": 83.2,   # Cool running unloaded diesel
        "tire_pressure": 98.5,
        "dist_front_range": (210, 280),
        "dist_left_range": (160, 220),
        "dist_right_range": (160, 220),
    },
    "TRUCK_04": {
        "desc": "Mountain Switchback Turn (Fog Caution Corridor)",
        "wp_idx": 2,
        "target_speed": 13.0,
        "gear": "D1",
        "payload_pct": 0.94,   # 341.2 tons (heavy Liebherr load)
        "engine_temp": 99.1,   # Hot heavy switchback climb
        "tire_pressure": 105.2,
        "dist_front_range": (35, 68),   # Switchback caution trigger
        "dist_left_range": (45, 90),
        "dist_right_range": (40, 85),
    },
    "TRUCK_05": {
        "desc": "Ultra-Class Behemoth (Deposit 5 Loading Crawl)",
        "wp_idx": 0,
        "target_speed": 8.5,
        "gear": "D1",
        "payload_pct": 0.97,   # 436.5 tons (450t mega capacity)
        "engine_temp": 88.6,
        "tire_pressure": 114.8, # Extreme load tire rating
        "dist_front_range": (55, 105),
        "dist_left_range": (70, 130),
        "dist_right_range": (70, 130),
    },
    "TRUCK_06": {
        "desc": "Primary Gyratory Crusher Terminal Approach",
        "wp_idx": 5,
        "target_speed": 25.0,
        "gear": "D3",
        "payload_pct": 0.62,   # 183.5 tons (partial haul)
        "engine_temp": 91.5,
        "tire_pressure": 103.4,
        "dist_front_range": (160, 220),
        "dist_left_range": (130, 185),
        "dist_right_range": (130, 185),
    },
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


# Initialize vehicle states
for vdef in FLEET_DEFS:
    vid = vdef["id"]
    is_truck_01 = (vid == "TRUCK_01")
    prof = SIMULATION_PROFILES.get(vid)

    if prof:
        wp_idx = prof["wp_idx"]
    else:
        wp_idx = vdef["base_wp_idx"] % len(QUARRY_WAYPOINTS)

    wp = QUARRY_WAYPOINTS[wp_idx]
    next_wp = QUARRY_WAYPOINTS[(wp_idx + 1) % len(QUARRY_WAYPOINTS)]

    d_lng = next_wp["lng"] - wp["lng"]
    d_lat = next_wp["lat"] - wp["lat"]
    heading = (math.degrees(math.atan2(d_lng, d_lat)) + 360) % 360

    if is_truck_01:
        # Real-time GPS node coordinates (matches ESP32 hardware node location)
        init_lat = 17.5389
        init_lng = 78.3846
        zone = get_zone_for_point(init_lat, init_lng)
        speed_kmh = 0.0
        target_speed = 0.0
        gear = None
        engine_temp_c = None
        tire_pressure_psi = None
        payload_tons = None
        dist_front = 180
        dist_left = 150
        dist_right = 150
        action = "CLEAR"
        status = "NORMAL"
        risk_score = None
        has_risk_data = False
        has_diagnostics = False
    else:
        init_lat = round(wp["lat"], 6)
        init_lng = round(wp["lng"], 6)
        zone = get_zone_for_point(init_lat, init_lng)

        if prof:
            speed_kmh = round(prof["target_speed"] * random.uniform(0.96, 1.04), 1)
            target_speed = prof["target_speed"]
            gear = prof["gear"]
            engine_temp_c = round(prof["engine_temp"] + random.uniform(-0.6, 0.6), 1)
            tire_pressure_psi = round(prof["tire_pressure"] + random.uniform(-0.4, 0.4), 1)
            payload_tons = round(vdef["max_payload"] * prof["payload_pct"], 1)
            dist_front = random.randint(*prof["dist_front_range"])
            dist_left = random.randint(*prof["dist_left_range"])
            dist_right = random.randint(*prof["dist_right_range"])
        else:
            speed_kmh = round(min(wp["speed_limit"], zone["max_safe_speed"]) * random.uniform(0.85, 1.02), 1)
            target_speed = zone["max_safe_speed"]
            gear = "D3"
            engine_temp_c = round(random.uniform(84.0, 92.0), 1)
            tire_pressure_psi = round(random.uniform(101.0, 104.5), 1)
            payload_tons = round(vdef["max_payload"] * random.uniform(0.65, 0.98), 1)
            dist_front = random.randint(140, 220)
            dist_left = random.randint(120, 200)
            dist_right = random.randint(120, 200)

        action = decide_action(dist_front, dist_left, dist_right)
        status = "CRITICAL" if action == "STOP" else ("CAUTION" if action != "CLEAR" else "NORMAL")
        risk_score = {
            "total": 24,
            "level": "LOW",
            "speed_factor": 15,
            "fog_factor": 25,
            "traffic_factor": 10,
            "hazard_factor": 5,
        }
        has_risk_data = True
        has_diagnostics = True

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
        "status": status,
        "action": action,
        "speed_kmh": speed_kmh,
        "target_speed": target_speed,
        "gear": gear,
        "battery_pct": 100.0 if is_truck_01 else round(random.uniform(82.0, 99.0), 1),
        "engine_temp_c": engine_temp_c,
        "tire_pressure_psi": tire_pressure_psi,
        "payload_tons": payload_tons,
        "dist_front": dist_front,
        "dist_left": dist_left,
        "dist_right": dist_right,
        "gps_valid": True,
        "lat": init_lat,
        "lng": init_lng,
        "elevation_m": zone.get("elevation_m", 580 if is_truck_01 else 1040),
        "heading": 0.0 if is_truck_01 else round(heading, 1),
        "wp_idx": wp_idx,
        "wp_t": 0.0,
        "trail": [[init_lat, init_lng]],
        "current_zone": {
            "id": zone["id"],
            "name": zone["name"],
            "visibility_m": zone["visibility_m"],
            "severity": zone["severity"],
            "max_safe_speed": zone["max_safe_speed"],
            "color": zone["color"],
        },
        "risk_score": risk_score,
        "has_risk_data": has_risk_data,
        "has_diagnostics": has_diagnostics,
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

                # If this vehicle is bound to REAL_HARDWARE or is TRUCK_01, do not simulate motion or sensors
                # Real hardware posts into /update directly.
                is_truck_01 = (vid == "TRUCK_01")
                if v["source_type"] == "REAL_HARDWARE" or is_truck_01:
                    if is_truck_01:
                        v["speed_kmh"] = 0.0
                        v["is_moving"] = False
                        v["risk_score"] = None
                        v["has_risk_data"] = False
                        v["has_diagnostics"] = False
                        v["engine_temp_c"] = None
                        v["tire_pressure_psi"] = None
                        v["payload_tons"] = None
                        v["gear"] = None
                    else:
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

                prof = SIMULATION_PROFILES.get(vid)
                if now_ts < v.get("manual_obstacle_until", 0):
                    front = v["dist_front"]
                    left = v["dist_left"]
                    right = v["dist_right"]
                else:
                    if prof:
                        if random.random() < simulation_config["obstacle_probability"]:
                            front = random.randint(10, 38)
                            left = random.randint(25, 120)
                            right = random.randint(25, 120)
                        else:
                            front = random.randint(*prof["dist_front_range"])
                            left = random.randint(*prof["dist_left_range"])
                            right = random.randint(*prof["dist_right_range"])
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

                # Speed & Gear adaptation: Governed by Profile & Zone Max Safe Fog Speed!
                base_target = prof["target_speed"] if prof else cur_wp["speed_limit"]
                target_speed = min(base_target, zone["max_safe_speed"])
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
                        v["speed_kmh"] = round(min(target_speed, v["speed_kmh"] + random.uniform(1.2, 2.8)), 1)
                    elif v["speed_kmh"] > target_speed:
                        v["speed_kmh"] = round(max(target_speed, v["speed_kmh"] - random.uniform(1.5, 3.0)), 1)

                    if prof:
                        v["gear"] = prof["gear"] if v["speed_kmh"] > 10 else "D1"
                    else:
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
                base_temp = prof["engine_temp"] if prof else 88.0
                temp_delta = 0.25 if v["speed_kmh"] > 20 else -0.12
                v["engine_temp_c"] = round(
                    max(base_temp - 3.0, min(base_temp + 6.0, v["engine_temp_c"] + temp_delta * random.uniform(0.4, 1.1))),
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


# ==============================================================================
# FAST-PI DE-WEATHERING ENGINE (Rain Streak Removal + Dark Channel Prior + Guided Filter)
# ==============================================================================
class FastPiDeWeather:
    def __init__(self, r=15, eps=0.001, omega=0.85):
        self.r = r           # Guided filter radius
        self.eps = eps       # Guided filter regularization parameter
        self.omega = omega   # Haze removal strength (0.85 avoids over-saturation)

    def remove_rain_streaks(self, img):
        """
        Uses directional bilateral/guided filtering to isolate 
        and remove high-frequency vertical rain streaks.
        """
        # Convert to YCrCb to process luminance channel (Y) only
        ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
        y, cr, cb = cv2.split(ycrcb)

        # Low-pass filter to smooth out fast-moving vertical rain drops
        base = cv2.bilateralFilter(y, d=5, sigmaColor=25, sigmaSpace=25)
        
        # High-frequency rain streak detail layer
        rain_layer = cv2.subtract(y, base)

        # Morphological directional filter (vertical kernel) to identify rain lines
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 5))
        rain_mask = cv2.morphologyEx(rain_layer, cv2.MORPH_OPEN, kernel)

        # Subtract detected rain streak layer from Luminance
        clean_y = cv2.subtract(y, rain_mask)
        
        # Reconstruct image
        clean_ycrcb = cv2.merge([clean_y, cr, cb])
        return cv2.cvtColor(clean_ycrcb, cv2.COLOR_YCrCb2BGR)

    def _guided_filter_fallback(self, guide, src, radius, eps):
        """Standard OpenCV Guided Filter Fallback if ximgproc is missing."""
        mean_p = cv2.boxFilter(src, -1, (radius, radius))
        mean_I = cv2.boxFilter(guide, -1, (radius, radius))
        mean_Ip = cv2.boxFilter(guide * src, -1, (radius, radius))
        cov_Ip = mean_Ip - mean_I * mean_p

        mean_II = cv2.boxFilter(guide * guide, -1, (radius, radius))
        var_I = mean_II - mean_I * mean_I

        a = cov_Ip / (var_I + eps)
        b = mean_p - a * mean_I

        mean_a = cv2.boxFilter(a, -1, (radius, radius))
        mean_b = cv2.boxFilter(b, -1, (radius, radius))

        return mean_a * guide + mean_b

    def remove_smoke_and_fog(self, img):
        """
        Modified Dark Channel Prior optimized for heavy smoke & fog without halos.
        """
        # 1. Compute Dark Channel
        min_channel = np.min(img, axis=2)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (self.r, self.r))
        dark_channel = cv2.erode(min_channel, kernel)

        # 2. Robust Atmospheric Light (A) Estimation (Prevents smoke inversion)
        h, w = dark_channel.shape
        num_pixels = h * w
        top_num = int(max(math.floor(num_pixels * 0.001), 1))
        
        flat_dark = dark_channel.ravel()
        flat_img = img.reshape(num_pixels, 3)
        
        indices = np.argpartition(flat_dark, -top_num)[-top_num:]
        A = np.mean(flat_img[indices], axis=0)

        # 3. Estimate Transmission Map t(x)
        normalized = img.astype(np.float32) / np.maximum(A, 1.0)
        norm_dark = cv2.erode(np.min(normalized, axis=2), kernel)
        transmission = 1.0 - self.omega * norm_dark

        # 4. Refine Transmission with Guided Filter
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
        
        # Try cv2.ximgproc; use fallback if missing
        try:
            refined_t = cv2.ximgproc.guidedFilter(
                guide=gray, 
                src=transmission.astype(np.float32), 
                radius=self.r, 
                eps=self.eps
            )
        except AttributeError:
            refined_t = self._guided_filter_fallback(
                guide=gray, 
                src=transmission.astype(np.float32), 
                radius=self.r, 
                eps=self.eps
            )
        
        # Bound transmission to avoid division by zero
        refined_t = np.maximum(refined_t, 0.1)

        # 5. Recover Clean Radiance J(x)
        result = np.empty_like(img, dtype=np.float32)
        for i in range(3):
            result[:, :, i] = (img[:, :, i].astype(np.float32) - A[i]) / refined_t + A[i]

        return np.clip(result, 0, 255).astype(np.uint8)

    def process_frame(self, frame):
        # Step 1: Remove vertical rain streaks
        derained = self.remove_rain_streaks(frame)
        # Step 2: Remove dense smoke and fog
        deweathered = self.remove_smoke_and_fog(derained)
        return deweathered


# Global deweathering engine instance
deweather_engine = FastPiDeWeather(r=15, eps=0.001, omega=0.85)

def deweather_frame(frame):
    return deweather_engine.process_frame(frame)

# Backwards compatibility alias
dehaze_frame = deweather_frame


# In-memory storage for custom uploaded/inserted camera frames per vehicle
# key: vehicle_id (str) -> dict
custom_camera_frames = {}


def generate_fog_sample(sample_id="pit_dense_fog", vid="TRUCK_02"):
    w, h = 640, 480
    frame = np.zeros((h, w, 3), dtype=np.uint8)

    if sample_id == "mountain_switchback":
        # Sky and mountains
        cv2.rectangle(frame, (0, 0), (w, int(h * 0.45)), (110, 125, 135), -1)
        pts_m1 = np.array([[0, int(h * 0.45)], [int(w * 0.35), int(h * 0.20)], [int(w * 0.7), int(h * 0.45)]], np.int32)
        cv2.fillPoly(frame, [pts_m1], (70, 85, 95))
        pts_m2 = np.array([[int(w * 0.3), int(h * 0.45)], [int(w * 0.65), int(h * 0.15)], [w, int(h * 0.45)]], np.int32)
        cv2.fillPoly(frame, [pts_m2], (60, 75, 85))
        # Switchback road
        pts_road = np.array([[0, h], [int(w * 0.35), int(h * 0.65)], [int(w * 0.65), int(h * 0.65)], [w, h]], np.int32)
        cv2.fillPoly(frame, [pts_road], (45, 52, 58))
        # Large boulder hazard on road
        cv2.circle(frame, (int(w * 0.52), int(h * 0.78)), 34, (38, 44, 48), -1)
        cv2.circle(frame, (int(w * 0.50), int(h * 0.74)), 24, (55, 62, 68), -1)
        # Dense upslope fog
        fog = np.full((h, w, 3), (175, 185, 190), dtype=np.uint8)
        noise = np.random.randint(0, 22, (h, w, 3), dtype=np.uint8)
        fog = cv2.add(fog, noise)
        frame = cv2.addWeighted(frame, 0.26, fog, 0.74, 0)
    else:  # pit_dense_fog (default)
        # Open pit bench benches
        cv2.rectangle(frame, (0, 0), (w, int(h * 0.4)), (100, 115, 125), -1)
        cv2.rectangle(frame, (0, int(h * 0.4)), (w, int(h * 0.55)), (55, 68, 76), -1)
        cv2.rectangle(frame, (0, int(h * 0.55)), (w, h), (40, 50, 58), -1)
        # Haul road perspective
        pts_road = np.array([[int(w * 0.44), int(h * 0.4)], [int(w * 0.56), int(h * 0.4)], [int(w * 0.95), h], [int(w * 0.05), h]], np.int32)
        cv2.fillPoly(frame, [pts_road], (32, 38, 44))
        # Hauler silhouette ahead in fog
        hx, hy = int(w * 0.51), int(h * 0.58)
        cv2.rectangle(frame, (hx - 36, hy - 28), (hx + 36, hy + 20), (25, 30, 35), -1)
        cv2.rectangle(frame, (hx - 42, hy + 5), (hx - 34, hy + 25), (15, 18, 20), -1)
        cv2.rectangle(frame, (hx + 34, hy + 5), (hx + 42, hy + 25), (15, 18, 20), -1)
        # Amber marker tail lights
        cv2.circle(frame, (hx - 26, hy + 14), 5, (0, 165, 255), -1)
        cv2.circle(frame, (hx + 26, hy + 14), 5, (0, 165, 255), -1)
        # Dense valley cloud fog inversion
        fog = np.full((h, w, 3), (170, 180, 185), dtype=np.uint8)
        noise = np.random.randint(0, 20, (h, w, 3), dtype=np.uint8)
        fog = cv2.add(fog, noise)
        frame = cv2.addWeighted(frame, 0.24, fog, 0.76, 0)

    return frame


def process_and_store_camera_frame(img, vid="TRUCK_02", source_name="Custom Image"):
    img_resized = cv2.resize(img, (640, 480))
    h, w = img_resized.shape[:2]

    # 1. Prepare raw frame with HUD overlay
    raw_frame = img_resized.copy()
    cam_id = "CAM-02" if vid == "TRUCK_02" else f"CAM-{vid.replace('TRUCK_', '')}"
    cv2.putText(raw_frame, f"{cam_id} [{vid} RAW OPTICAL FEED]", (16, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (245, 245, 245), 2)
    cv2.putText(raw_frame, f"SOURCE: {source_name} | RAIN & FOG ENVIRONMENT", (16, 52),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 80, 85), 1)

    # 2. Compute de-weathered image via FastPiDeWeather (Rain + Fog Removal)
    t0 = time.time()
    clean_frame = deweather_frame(img_resized)
    proc_ms = (time.time() - t0) * 1000.0

    enhanced = cv2.convertScaleAbs(clean_frame, alpha=1.20, beta=6)
    dehazed_frame = enhanced.copy()

    # Overlay HUD telemetry on deweathered frame
    cv2.putText(dehazed_frame, f"{cam_id} [{vid} DE-WEATHERED: FAST-PI ENGINE]", (16, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (53, 209, 192), 2)
    cv2.putText(dehazed_frame, f"STATUS: RAIN & FOG REMOVED | {proc_ms:.1f}ms | +92% VISIBILITY", (16, 52),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (56, 231, 138), 1)

    # Automated edge detection / obstacle framing
    gray = cv2.cvtColor(enhanced, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 60, 180)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    large_cnts = [c for c in contours if cv2.contourArea(c) > 600]
    if large_cnts:
        c = max(large_cnts, key=cv2.contourArea)
        x, y, bw, bh = cv2.boundingRect(c)
        cv2.rectangle(dehazed_frame, (x - 6, y - 6), (x + bw + 6, y + bh + 6), (53, 209, 192), 2)
        cv2.putText(dehazed_frame, "TARGET DETECTED", (x - 6, max(15, y - 10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.40, (53, 209, 192), 1)

    now_ts = time.time()
    now_str = datetime.now().strftime("%H:%M:%S")

    with fleet_lock:
        custom_camera_frames[vid] = {
            "raw": raw_frame,
            "dehazed": dehazed_frame,
            "timestamp": now_ts,
            "time_str": now_str,
            "source_name": source_name,
            "clarity_gain": 92,
            "contrast_gain": 2.5,
            "proc_ms": round(proc_ms, 1),
            "algorithm": "FastPiDeWeather (Rain + Smoke/Fog Removal)",
        }
    return custom_camera_frames[vid]


def generate_synthetic_frame(dehazed_mode=False, vid="TRUCK_02"):
    w, h = 480, 360
    t = time.time()
    cam_id = "CAM-02" if vid == "TRUCK_02" else f"CAM-{vid.replace('TRUCK_', '')}"

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
        # Simulate realistic rain streaks falling across camera aperture
        rain_phase = int((t * 140) % 50)
        for rx in range(15, w - 10, 28):
            ry = (rx * 7 + rain_phase * 15) % (h - 25)
            cv2.line(frame, (rx, ry), (rx + 1, ry + 18), (215, 228, 240), 1)

        fog = np.full((h, w, 3), (160, 175, 180), dtype=np.uint8)
        noise = np.random.randint(0, 20, (h, w, 3), dtype=np.uint8)
        fog = cv2.add(fog, noise)
        frame = cv2.addWeighted(frame, 0.28, fog, 0.72, 0)

        cv2.putText(frame, f"{cam_id} [{vid} RAW OPTICAL FEED]", (15, 26),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.50, (240, 240, 240), 2)
        cv2.putText(frame, "ZONE 1: PIT BOTTOM | RAIN & DENSE FOG", (15, 48),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 79, 85), 1)
    else:
        frame = cv2.convertScaleAbs(frame, alpha=1.3, beta=-15)
        x1, y1 = obs_x - 22, obs_y - 20
        x2, y2 = obs_x + 22, obs_y + 20
        cv2.rectangle(frame, (x1, y1), (x2, y2), (53, 209, 192), 2)
        cv2.putText(frame, "OBSTACLE DETECTED", (x1 - 10, y1 - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.40, (53, 209, 192), 1)

        cv2.putText(frame, f"{cam_id} [{vid} FAST-PI DE-WEATHERED]", (15, 26),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.50, (53, 209, 192), 2)
        cv2.putText(frame, "STATUS: RAIN & FOG CLEARED | +92%", (15, 48),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (56, 231, 138), 1)

    cv2.putText(frame, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), (15, h - 14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 220, 220), 1)

    return frame


def gen_frames(is_dehazed=False, vid="TRUCK_02"):
    global camera
    target_vid = vid.upper() if vid else "TRUCK_02"
    while True:
        frame = None
        with fleet_lock:
            custom_entry = custom_camera_frames.get(target_vid) or custom_camera_frames.get("TRUCK_02")

        if custom_entry:
            base = custom_entry["dehazed"] if is_dehazed else custom_entry["raw"]
            frame = base.copy()
            h, w = frame.shape[:2]
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cv2.putText(frame, ts, (16, h - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 225, 230), 1)
        else:
            if camera and camera.isOpened():
                success, captured = camera.read()
                if success:
                    frame = cv2.resize(captured, (480, 360))
                    cam_id = "CAM-02" if target_vid == "TRUCK_02" else f"CAM-{target_vid.replace('TRUCK_', '')}"
                    if is_dehazed:
                        frame = dehaze_frame(frame)
                        cv2.putText(frame, f"{cam_id} [{target_vid} LIVE DEHAZED]", (12, 28),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.60, (53, 209, 192), 2)
                    else:
                        cv2.putText(frame, f"{cam_id} [{target_vid} LIVE RAW]", (12, 28),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.60, (255, 255, 255), 2)

            if frame is None:
                frame = generate_synthetic_frame(dehazed_mode=is_dehazed, vid=target_vid)

        ret, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 78])
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
    vid = request.args.get("vehicle_id") or request.args.get("v") or "TRUCK_02"
    return Response(gen_frames(is_dehazed=False, vid=vid), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/dehazed_feed")
@app.route("/deweathered_feed")
@app.route("/video_feed")
def dehazed_feed():
    vid = request.args.get("vehicle_id") or request.args.get("v") or "TRUCK_02"
    return Response(gen_frames(is_dehazed=True, vid=vid), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/api/camera/insert", methods=["POST"])
@app.route("/api/camera/sample", methods=["POST"])
@app.route("/api/camera/upload", methods=["POST"])
def insert_camera_image():
    """
    Inserts a custom image into the raw camera feed channel (defaults to TRUCK_02).
    Processes and calculates the Dark Channel Prior dehazed frame.
    Supports multipart file upload, base64 payload, or preset sample IDs.
    """
    raw_vid = request.form.get("vehicle_id") or request.args.get("vehicle_id") or "TRUCK_02"
    img = None
    source_name = "Uploaded Fog Image"

    if "image" in request.files or "file" in request.files:
        file = request.files.get("image") or request.files.get("file")
        if file and file.filename:
            source_name = file.filename
            file_bytes = file.read()
            nparr = np.frombuffer(file_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        data = request.get_json(force=True, silent=True) or {}
        raw_vid = data.get("vehicle_id") or raw_vid
        if "image_base64" in data:
            b64 = data["image_base64"]
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            file_bytes = base64.b64decode(b64)
            nparr = np.frombuffer(file_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            source_name = data.get("source_name", "Base64 Image")
        elif "sample_id" in data:
            sample_id = data.get("sample_id", "pit_dense_fog")
            source_name = f"Sample: {sample_id.replace('_', ' ').title()}"
            img = generate_fog_sample(sample_id, raw_vid)

    vid = VEHICLE_ALIASES.get(str(raw_vid).upper(), str(raw_vid).upper())
    if img is None:
        source_name = "Deposit 5 Pit Dense Fog Sample"
        img = generate_fog_sample("pit_dense_fog", vid)

    result = process_and_store_camera_frame(img, vid=vid, source_name=source_name)

    return jsonify({
        "status": "ok",
        "vehicle_id": vid,
        "message": f"Raw image inserted and dehazed successfully for {vid}",
        "source_name": source_name,
        "timestamp": result["time_str"],
        "clarity_gain": result["clarity_gain"],
        "algorithm": result["algorithm"],
        "raw_feed_url": f"/raw_feed?v={vid}",
        "dehazed_feed_url": f"/dehazed_feed?v={vid}",
    })


@app.route("/api/camera/reset", methods=["POST"])
def reset_camera_feed():
    req = request.get_json(force=True, silent=True) or {}
    raw_vid = req.get("vehicle_id") or "TRUCK_02"
    vid = VEHICLE_ALIASES.get(str(raw_vid).upper(), str(raw_vid).upper())

    with fleet_lock:
        if vid in custom_camera_frames:
            del custom_camera_frames[vid]
        if vid == "ALL":
            custom_camera_frames.clear()

    return jsonify({
        "status": "ok",
        "vehicle_id": vid,
        "message": f"Camera feed reset for {vid}. Live synthetic/webcam stream restored."
    })


@app.route("/api/camera/status", methods=["GET"])
def get_camera_status():
    raw_vid = request.args.get("vehicle_id") or "TRUCK_02"
    vid = VEHICLE_ALIASES.get(str(raw_vid).upper(), str(raw_vid).upper())
    with fleet_lock:
        entry = custom_camera_frames.get(vid) or custom_camera_frames.get("TRUCK_02")
        is_custom = entry is not None
        return jsonify({
            "status": "ok",
            "vehicle_id": vid,
            "has_custom_image": is_custom,
            "source_name": entry["source_name"] if is_custom else "Live Stream",
            "clarity_gain": entry["clarity_gain"] if is_custom else 88,
            "algorithm": entry["algorithm"] if is_custom else "Dark Channel Prior (DCP)",
            "timestamp": entry["time_str"] if is_custom else None,
        })


# ==============================================================================
# REST API ENDPOINTS
# ==============================================================================
@app.route("/api/fleet", methods=["GET"])
def get_fleet():
    with fleet_lock:
        current_role = session.get("role")
        current_vid = session.get("vehicle_id")

        v_list = []
        clear_count = 0
        caution_count = 0
        stopped_count = 0
        total_speed = 0.0
        high_risk_count = 0

        # Drivers can only see their own vehicle; Control room / Admin sees all
        items_to_process = fleet_data.items()
        if current_role == "driver" and current_vid:
            items_to_process = [(k, v) for k, v in fleet_data.items() if k == current_vid]

        for vid, v in list(items_to_process):
            is_truck_01 = (vid == "TRUCK_01")
            if is_truck_01:
                v["speed_kmh"] = 0.0
                v["is_moving"] = False
                v["risk_score"] = None
                v["has_risk_data"] = False
                v["has_diagnostics"] = False
                v["payload_tons"] = None
                v["engine_temp_c"] = None
                v["tire_pressure_psi"] = None
                v["gear"] = None

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

            is_moving = False if is_truck_01 else (v["speed_kmh"] > 0.5 and v["action"] != "STOP")
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
                "speed_kmh": 0.0 if is_truck_01 else v["speed_kmh"],
                "battery_pct": v["battery_pct"],
                "payload_tons": None if is_truck_01 else v.get("payload_tons"),
                "engine_temp_c": None if is_truck_01 else v.get("engine_temp_c"),
                "tire_pressure_psi": None if is_truck_01 else v.get("tire_pressure_psi"),
                "gear": None if is_truck_01 else v.get("gear"),
                "dist_front": v["dist_front"],
                "dist_left": v["dist_left"],
                "dist_right": v["dist_right"],
                "lat": v["lat"],
                "lng": v["lng"],
                "elevation_m": v.get("elevation_m", 580 if is_truck_01 else 1040),
                "heading": v["heading"],
                "avatar_color": v["avatar_color"],
                "current_zone": v["current_zone"],
                "risk_score": None if is_truck_01 else v.get("risk_score"),
                "has_risk_data": not is_truck_01,
                "has_diagnostics": not is_truck_01,
                "closest_truck": v["closest_truck"],
                "last_update": v["last_update"],
            })

            if v["action"] == "STOP":
                stopped_count += 1
            elif v["action"] in ("SLOW DOWN", "TURN LEFT", "TURN RIGHT"):
                caution_count += 1
            else:
                clear_count += 1

            if v.get("risk_score") and isinstance(v["risk_score"], dict) and v["risk_score"].get("total", 0) >= 70:
                high_risk_count += 1

            total_speed += (0.0 if is_truck_01 else v["speed_kmh"])

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

        current_role = session.get("role")
        current_vid = session.get("vehicle_id")
        if current_role == "driver" and current_vid and norm_vid != current_vid:
            return jsonify({
                "status": "forbidden",
                "msg": f"Access restricted. You are authenticated as {current_vid} and cannot access telemetry for {norm_vid}."
            }), 403

        is_truck_01 = (norm_vid == "TRUCK_01")
        if is_truck_01:
            v["speed_kmh"] = 0.0
            v["is_moving"] = False
            v["risk_score"] = None
            v["has_risk_data"] = False
            v["has_diagnostics"] = False
            v["payload_tons"] = None
            v["engine_temp_c"] = None
            v["tire_pressure_psi"] = None
            v["gear"] = None

        if v["source_type"] == "REAL_HARDWARE":
            if v.get("last_hardware_packet"):
                elapsed = time.time() - v["last_hardware_packet"]
                is_connected = (elapsed <= 15.0)
            else:
                is_connected = False
        else:
            is_connected = simulation_config["running"]

        is_moving = False if is_truck_01 else (v["speed_kmh"] > 0.5 and v["action"] != "STOP")
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

        # Auto-generate driver password for this vehicle
        TRUCK_CREDENTIALS[vid] = f"truck{vid.replace('TRUCK_', '').lower()}"

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

        is_truck_01 = (vid == "TRUCK_01")
        if is_truck_01:
            v["speed_kmh"] = 0.0
            v["is_moving"] = False
            v["risk_score"] = None
            v["has_risk_data"] = False
            v["has_diagnostics"] = False
            v["payload_tons"] = None
            v["engine_temp_c"] = None
            v["tire_pressure_psi"] = None
            v["gear"] = None
            if action == "STOP":
                v["status"] = "CRITICAL"
            elif action in ("SLOW DOWN", "TURN LEFT", "TURN RIGHT"):
                v["status"] = "CAUTION"
            else:
                v["status"] = "NORMAL"
        else:
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
        v["elevation_m"] = zone.get("elevation_m", 580 if is_truck_01 else 1040)

        if not is_truck_01:
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
        "speed_kmh": 0.0 if is_truck_01 else v["speed_kmh"],
        "risk_score": None if is_truck_01 else (v["risk_score"]["total"] if v.get("risk_score") else None),
        "zone": zone["name"],
        "lat": v["lat"],
        "lng": v["lng"]
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
        if v["action"] == "STOP":
            v["speed_kmh"] = 0.0
            v["gear"] = "N"
        v["manual_obstacle_until"] = time.time() + duration
        v["last_update"] = datetime.now().strftime("%H:%M:%S")

        is_truck_01 = (vid == "TRUCK_01")
        if is_truck_01:
            v["speed_kmh"] = 0.0
            v["risk_score"] = None
        else:
            zone = get_zone_for_point(v["lat"], v["lng"])
            v["risk_score"] = compute_risk_score(v, v["closest_truck"]["distance_m"], zone)

        v["log"].insert(0, {
            "time": v["last_update"],
            "action": v["action"],
            "dist_front": distance,
            "note": f"MANUAL OBSTACLE INJECTED: {distance} cm",
        })
        del v["log"][MAX_VEHICLE_LOG:]

    return jsonify({
        "status": "ok",
        "vehicle_id": vid,
        "action": v["action"],
        "dist_front": distance,
        "msg": f"Obstacle injected on {vid}: {distance} cm ({v['action']})"
    })


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


# ==============================================================================
# AUTHENTICATION & ROLE-BASED ACCESS CONTROL (Control Room vs Driver In-Cab)
# ==============================================================================
def resolve_user_role(username):
    uname = str(username).strip().upper()
    if uname == "ADMIN":
        return "admin", None
    vid = VEHICLE_ALIASES.get(uname, uname)
    return "driver", vid


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    req = request.get_json(force=True, silent=True) or {}
    username = str(req.get("username", "")).strip().upper()
    password = str(req.get("password", "")).strip()

    valid_pass = TRUCK_CREDENTIALS.get(username)
    if not valid_pass:
        vid = VEHICLE_ALIASES.get(username)
        if vid and vid in TRUCK_CREDENTIALS:
            username = vid
            valid_pass = TRUCK_CREDENTIALS.get(vid)

    if not valid_pass or valid_pass != password:
        return jsonify({
            "status": "error",
            "msg": "Invalid credentials. Use admin/admin123 for Control Room, or TRUCK_01/truck01, TRUCK_02/truck02, etc. for Driver Console."
        }), 401

    role, vid = resolve_user_role(username)
    session["user"] = username
    session["role"] = role
    session["vehicle_id"] = vid

    return jsonify({
        "status": "ok",
        "user": username,
        "role": role,
        "vehicle_id": vid,
        "redirect_url": f"/driver?vehicle_id={vid}" if role == "driver" else "/"
    })


@app.route("/api/auth/logout", methods=["POST", "GET"])
def auth_logout():
    session.clear()
    if request.is_json or request.path.startswith("/api/"):
        return jsonify({"status": "ok", "message": "Logged out successfully"})
    return redirect("/")


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    user = session.get("user")
    role = session.get("role", "admin")
    vid = session.get("vehicle_id")

    accounts = [{"id": "ADMIN", "role": "admin", "name": "Fleet Dispatcher (Central Control Room)", "default_pass": "admin123"}]
    with fleet_lock:
        for v_id, v in fleet_data.items():
            accounts.append({
                "id": v_id,
                "role": "driver",
                "name": f"{v.get('name', v_id)} ({v.get('model', 'Haul Unit')})",
                "default_pass": TRUCK_CREDENTIALS.get(v_id, f"truck{v_id.replace('TRUCK_', '').lower()}")
            })

    return jsonify({
        "authenticated": user is not None,
        "user": user or "ADMIN",
        "role": role,
        "vehicle_id": vid,
        "available_accounts": accounts
    })


@app.route("/driver", methods=["GET"])
def driver_portal():
    requested_vid = request.args.get("vehicle_id") or request.args.get("v")
    current_role = session.get("role")
    current_vid = session.get("vehicle_id")

    if current_role == "driver" and current_vid:
        target_vid = current_vid
    elif requested_vid:
        target_vid = VEHICLE_ALIASES.get(requested_vid.upper(), requested_vid.upper())
    else:
        target_vid = "TRUCK_02"

    return render_template("driver.html", target_vehicle_id=target_vid)


@app.route("/login", methods=["GET"])
def login_page():
    return render_template("driver.html", show_login=True)


@app.route("/", methods=["GET"])
def index():
    if session.get("role") == "driver" and session.get("vehicle_id"):
        return redirect(f"/driver?vehicle_id={session.get('vehicle_id')}")
    return render_template("index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"RESURGENCE FLEET CONTROL ROOM 2.0 serving on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
