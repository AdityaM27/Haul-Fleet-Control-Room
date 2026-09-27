"""
Vehicle Agent Main Entry Point (Section 14)
Raspberry Pi Edge Computer Application for Autonomous & Teleoperated Mining Trucks
Usage:
  python vehicle_agent/main.py --vehicle TRUCK_01 --sim
"""

import argparse
import os
import sys
import time
from datetime import datetime

# Add project root to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vehicle_agent.sensors import RTKGNSSDriver, LiDARSensor, AICameraSensor, UltrasonicSensor
from vehicle_agent.perception import SensorFusionEngine
from vehicle_agent.safety import LocalSafetyEngine
from vehicle_agent.communication import BackendClient
from vehicle_agent.state import VehicleStateManager

def run_agent(vehicle_id: str, sim_mode: bool = True, backend_url: str = "http://127.0.0.1:5000", iterations: int = 0):
    print("=" * 65)
    print(f" RESURGENCE VEHICLE AGENT — {vehicle_id}")
    print(" EDGE COMPUTING STACK: Raspberry Pi + RTK GNSS + LiDAR + Camera")
    print("=" * 65)

    # Initialize subsystems
    rtk = RTKGNSSDriver(sim_mode=sim_mode)
    lidar = LiDARSensor(sim_mode=sim_mode)
    camera = AICameraSensor(sim_mode=sim_mode)
    sonar = UltrasonicSensor(sim_mode=sim_mode)

    fusion = SensorFusionEngine()
    safety = LocalSafetyEngine(vehicle_id)
    state = VehicleStateManager(vehicle_id)
    backend = BackendClient(backend_url)

    count = 0
    try:
        while True:
            count += 1
            now_ts = time.time()
            now_str = datetime.now().strftime("%H:%M:%S")

            # 1. Read Raw Sensors
            gnss_data = rtk.read_telemetry()
            # For demonstration, simulate obstacle on demand
            obs_ahead = (vehicle_id == "TRUCK_01" and count % 20 in (10, 11))
            lidar_data = lidar.scan(obstacle_ahead=obs_ahead, true_distance_m=11.2)
            cam_data = camera.detect(obstacle_ahead=obs_ahead, label="ROCK")
            sonar_data = sonar.measure_distance(obstacle_ahead=obs_ahead, true_distance_m=11.0)

            # 2. Multi-Sensor Perception Fusion
            fused = fusion.fuse(lidar_data, cam_data, sonar_data)

            # 3. Local Safety Engine Evaluation
            safety_decision = safety.evaluate(
                current_speed_kmh=gnss_data["speed_kmh"],
                perception_result=fused,
                fog_visibility_m=75.0
            )

            # 4. Update Unified Vehicle State
            state.update_position(gnss_data["latitude"], gnss_data["longitude"], gnss_data["altitude_m"])
            state.update_motion(gnss_data["speed_kmh"], gnss_data["heading_deg"])
            state.update_sensors(
                lidar_obs=fused["fusion_state"] == "CONFIRMED_HAZARD",
                lidar_dist=lidar_data["distance_m"],
                sonar_dist=sonar_data["distance_m"],
                cam_label=fused["identified_object"],
                cam_conf=fused["camera_confidence"]
            )
            state.update_safety(
                status=safety_decision["status"],
                rec_speed=safety_decision["final_safe_speed_kmh"],
                emergency=safety_decision["emergency"]
            )

            # Print telemetry tick
            if count % 5 == 1:
                print(f"[{now_str}] [{vehicle_id}] Pos: ({state.latitude}, {state.longitude}) | Speed: {state.speed_kmh}km/h | Safe: {state.recommended_speed_kmh}km/h | Status: {state.safety_status}")

            if iterations > 0 and count >= iterations:
                break
            time.sleep(0.5)

    except KeyboardInterrupt:
        print(f"\n[Terminating] {vehicle_id} Vehicle Agent stopped.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Raspberry Pi Edge Vehicle Agent")
    parser.add_argument("--vehicle", default="TRUCK_01", help="Vehicle Identifier")
    parser.add_argument("--sim", action="store_true", default=True, help="Run in simulation mode")
    parser.add_argument("--backend", default="http://127.0.0.1:5000", help="Control Room URL")
    parser.add_argument("--test-ticks", type=int, default=0, help="Run N ticks and exit (for unit testing)")
    args = parser.parse_args()

    run_agent(args.vehicle, sim_mode=args.sim, backend_url=args.backend, iterations=args.test_ticks)
