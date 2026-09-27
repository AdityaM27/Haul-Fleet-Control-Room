"""
Multi-Sensor Fusion Engine (Section 10)
Corroborates Solid-State LiDAR + AI Camera + Ultrasonic Sonar
Filters sensor noise before triggering emergency stops and obstacle hazard mitigation.
"""

from typing import Dict, Any

class SensorFusionEngine:
    def __init__(self, min_confidence: float = 0.80, max_corroboration_delta_m: float = 3.5):
        self.min_confidence = min_confidence
        self.max_corroboration_delta_m = max_corroboration_delta_m

    def fuse(self, lidar_data: Dict[str, Any], camera_data: Dict[str, Any],
             sonar_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sensor Fusion Rule:
          - LiDAR provides range & geometry
          - Camera provides visual semantic identification ("ROCK", "BOULDER", etc.)
          - Ultrasonic sonar corroborates physical distance
        Requires at least 2 corroborating sensor modalities to confirm a critical obstacle.
        """
        has_lidar = lidar_data.get("obstacle_detected", False)
        lidar_dist = lidar_data.get("distance_m")

        has_cam = camera_data.get("detected", False) and camera_data.get("confidence", 0.0) >= self.min_confidence
        cam_label = camera_data.get("label", "CLEAR")
        cam_conf = camera_data.get("confidence", 0.0)

        has_sonar = sonar_data.get("obstacle_detected", False)
        sonar_dist = sonar_data.get("distance_m")

        # Corroboration score
        corroboration_count = sum([1 for flag in (has_lidar, has_cam, has_sonar) if flag])

        # Distance agreement check between LiDAR and Sonar
        dist_agreement = False
        fused_distance = None

        if has_lidar and has_sonar and lidar_dist and sonar_dist:
            if abs(lidar_dist - sonar_dist) <= self.max_corroboration_delta_m:
                dist_agreement = True
                fused_distance = round((lidar_dist + sonar_dist) / 2.0, 1)
        elif has_lidar and lidar_dist:
            fused_distance = round(lidar_dist, 1)
        elif has_sonar and sonar_dist:
            fused_distance = round(sonar_dist, 1)

        # Decision Logic:
        # If 2 or more sensors corroborate and distance is close -> CONFIRMED_HAZARD
        if corroboration_count >= 2 and fused_distance is not None:
            if fused_distance <= 15.0:
                fusion_state = "CONFIRMED_HAZARD"
                action_required = "STOP"
                hazard_type = "OBSTACLE"
                severity = "CRITICAL"
            elif fused_distance <= 35.0:
                fusion_state = "PROXIMITY_CAUTION"
                action_required = "SLOW_DOWN"
                hazard_type = "OBSTACLE"
                severity = "WARNING"
            else:
                fusion_state = "ADVISORY"
                action_required = "MAINTAIN"
                hazard_type = "NONE"
                severity = "INFO"
        elif corroboration_count == 1:
            # Single sensor hit: treated as unconfirmed / transient noise
            fusion_state = "UNCONFIRMED_PROBE"
            action_required = "SCAN"
            hazard_type = "NONE"
            severity = "INFO"
        else:
            fusion_state = "CLEAR"
            action_required = "NOMINAL"
            hazard_type = "NONE"
            severity = "NONE"

        return {
            "fusion_state": fusion_state,
            "action_required": action_required,
            "corroboration_count": corroboration_count,
            "distance_agreement": dist_agreement,
            "fused_distance_m": fused_distance,
            "identified_object": cam_label if has_cam else "UNKNOWN",
            "camera_confidence": cam_conf,
            "hazard_type": hazard_type,
            "severity": severity
        }
