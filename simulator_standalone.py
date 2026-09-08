"""
STANDALONE 6-TRUCK FLEET SIMULATOR & ESP32 PROTOTYPE TESTER

Use this script to test external telemetry injection into http://localhost:5000/update.

Modes:
  1. Simulate all 6 trucks (Truck 1 to Truck 6)
  2. Simulate ONLY Truck 1 (mimicking your ESP32 + GPS prototype)

Usage:
  python simulator_standalone.py
"""

import time
import random
import requests

SERVER_URL = "http://localhost:5000/update"

TRUCK_IDS = [
    "TRUCK_01",  # Truck 1 (ESP32 Prototype)
    "TRUCK_02",  # Truck 2
    "TRUCK_03",  # Truck 3
    "TRUCK_04",  # Truck 4
    "TRUCK_05",  # Truck 5
    "TRUCK_06",  # Truck 6
]

positions = {
    "TRUCK_01": [17.3850, 78.4867],
    "TRUCK_02": [17.3875, 78.4892],
    "TRUCK_03": [17.3900, 78.4865],
    "TRUCK_04": [17.3905, 78.4832],
    "TRUCK_05": [17.3878, 78.4810],
    "TRUCK_06": [17.3845, 78.4838],
}


def decide_action(front, left, right):
    if front < 15:
        if left > right and left > 40:
            return "TURN LEFT"
        if right > left and right > 40:
            return "TURN RIGHT"
        return "STOP"
    if front < 40:
        if left > right and left > 40:
            return "TURN LEFT"
        if right > left and right > 40:
            return "TURN RIGHT"
        return "SLOW DOWN"
    return "CLEAR"


def main():
    print("=" * 65)
    print(" RESURGENCE STANDALONE TELEMETRY / ESP32 PROTOTYPE SIMULATOR")
    print(f" Target Endpoint: {SERVER_URL}")
    print("=" * 65)
    print("\nSelect test mode:")
    print("  [1] Send ESP32 telemetry ONLY for Truck 1 (Demo Prototype)")
    print("  [2] Send telemetry for all 6 trucks simultaneously")

    mode = "1"  # Default to Truck 1 ESP32 prototype

    print(f"\nRunning in Mode {mode}: Simulating ESP32 + GPS packets for Truck 1...\n")

    while True:
        target_trucks = ["TRUCK_01"] if mode == "1" else TRUCK_IDS

        for vid in target_trucks:
            pos = positions[vid]
            pos[0] += random.uniform(-0.00003, 0.00003)
            pos[1] += random.uniform(-0.00003, 0.00003)

            # Occasional obstacle
            if random.random() < 0.20:
                front = random.randint(8, 38)
            else:
                front = random.randint(70, 220)

            left = random.randint(40, 180)
            right = random.randint(40, 180)
            action = decide_action(front, left, right)

            payload = {
                "vehicle_id": vid,
                "dist_front": front,
                "dist_left": left,
                "dist_right": right,
                "action": action,
                "lat": round(pos[0], 6),
                "lng": round(pos[1], 6),
                "speed": random.randint(10, 26),
                "gps_valid": True,
            }

            try:
                res = requests.post(SERVER_URL, json=payload, timeout=1.5)
                if res.status_code == 200:
                    rjson = res.json()
                    print(f"-> [ESP32 Packet Sent] {vid}: Front={front:3d}cm | Action={action:10s} | Risk={rjson.get('risk_score')}/100 | Zone={rjson.get('zone')}")
            except requests.exceptions.ConnectionError:
                print(f"[!] Server not reachable at {SERVER_URL}. Is server.py running?")
                break
            except Exception as e:
                print(f"[!] Error: {e}")

        time.sleep(1.2)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nSimulator stopped.")
