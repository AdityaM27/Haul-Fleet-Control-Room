"""
Unified Vehicle State Schema (Section 3)
Resurgence Fleet Digital Twin - Edge Raspberry Pi Module
"""

import time
from typing import Dict, Any, Optional

class VehicleStateManager:
    """
    Maintains and serializes the authoritative local vehicle state for the truck.
    Conforms to the standardized edge state format.
    """
    def __init__(self, vehicle_id: str):
        self.vehicle_id = vehicle_id
        self.latitude = 18.581234
        self.longitude = 81.219876
        self.altitude = 842.3
        self.rtk_status = "FIX"

        self.speed_kmh = 12.5
        self.heading_deg = 184.2

        self.lidar_obstacle = False
        self.lidar_distance_m: Optional[float] = None
        self.ultrasonic_distance_m: Optional[float] = None
        self.camera_detection = "CLEAR"
        self.camera_confidence = 0.95

        self.safety_status = "NORMAL"
        self.recommended_speed_kmh = 18.0
        self.emergency = False

        self.v2v_enabled = True
        self.v2v_communication_status = "CONNECTED"

    def update_position(self, lat: float, lng: float, alt: float, rtk: str = "FIX"):
        self.latitude = round(lat, 6)
        self.longitude = round(lng, 6)
        self.altitude = round(alt, 1)
        self.rtk_status = rtk

    def update_motion(self, speed_kmh: float, heading_deg: float):
        self.speed_kmh = round(speed_kmh, 1)
        self.heading_deg = round(heading_deg, 1)

    def update_sensors(self, lidar_obs: bool, lidar_dist: Optional[float],
                       sonar_dist: Optional[float], cam_label: str, cam_conf: float):
        self.lidar_obstacle = lidar_obs
        self.lidar_distance_m = round(lidar_dist, 1) if lidar_dist is not None else None
        self.ultrasonic_distance_m = round(sonar_dist, 1) if sonar_dist is not None else None
        self.camera_detection = cam_label
        self.camera_confidence = round(cam_conf, 2)

    def update_safety(self, status: str, rec_speed: float, emergency: bool = False):
        self.safety_status = status
        self.recommended_speed_kmh = round(rec_speed, 1)
        self.emergency = emergency

    def to_dict(self) -> Dict[str, Any]:
        """Returns standard Section 3 dictionary representation."""
        return {
            "vehicle_id": self.vehicle_id,
            "position": {
                "latitude": self.latitude,
                "longitude": self.longitude,
                "altitude": self.altitude,
                "rtk_status": self.rtk_status
            },
            "motion": {
                "speed_kmh": self.speed_kmh,
                "heading_deg": self.heading_deg
            },
            "sensors": {
                "lidar_obstacle": self.lidar_obstacle,
                "lidar_distance_m": self.lidar_distance_m,
                "ultrasonic_distance_m": self.ultrasonic_distance_m,
                "camera_detection": self.camera_detection,
                "camera_confidence": self.camera_confidence
            },
            "safety": {
                "status": self.safety_status,
                "recommended_speed_kmh": self.recommended_speed_kmh,
                "emergency": self.emergency
            },
            "v2v": {
                "enabled": self.v2v_enabled,
                "communication_status": self.v2v_communication_status
            }
        }
