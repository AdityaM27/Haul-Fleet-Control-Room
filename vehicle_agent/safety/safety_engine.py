"""
Edge Safety Engine (Section 12)
Local Decision-Making on Raspberry Pi
Computes: final_safe_speed = min(fog_safe_speed, obstacle_safe_speed, terrain_safe_speed, v2v_safe_speed)
"""

from typing import Dict, Any, Optional

class LocalSafetyEngine:
    def __init__(self, vehicle_id: str):
        self.vehicle_id = vehicle_id

    def evaluate(self, current_speed_kmh: float,
                 perception_result: Dict[str, Any],
                 received_v2v_advisories: list,
                 fog_visibility_m: float = 85.0,
                 is_hairpin: bool = False) -> Dict[str, Any]:
        """
        Calculates safe speed recommendation and control action.
        Integrates local sensor perception, DFRI visibility, and received V2V hazard alerts.
        """
        # 1. Obstacle Limit from Sensor Fusion
        fused_dist = perception_result.get("fused_distance_m")
        if perception_result.get("fusion_state") == "CONFIRMED_HAZARD":
            speed_obs = 0.0
        elif fused_dist and fused_dist <= 25.0:
            speed_obs = 8.0
        elif fused_dist and fused_dist <= 50.0:
            speed_obs = 15.0
        else:
            speed_obs = 35.0

        # 2. Fog (DFRI) limit
        if fog_visibility_m < 10.0:
            speed_fog = 5.0
        elif fog_visibility_m < 25.0:
            speed_fog = 10.0
        elif fog_visibility_m < 50.0:
            speed_fog = 18.0
        elif fog_visibility_m < 100.0:
            speed_fog = 25.0
        else:
            speed_fog = 35.0

        # 3. Terrain / Curvature Limit
        speed_terrain = 12.0 if is_hairpin else 35.0

        # 4. V2V Advisory Limit (Section 12)
        speed_v2v = 35.0
        active_v2v_alert = None
        if received_v2v_advisories:
            # Pick lowest safe speed from incoming V2V warnings
            for adv in received_v2v_advisories:
                v_speed = adv.get("v2v_safe_speed_kmh", 35.0)
                if v_speed < speed_v2v:
                    speed_v2v = v_speed
                    active_v2v_alert = adv

        # Composite speed: minimum of all safety bounds
        all_limits = [
            (speed_obs, "Obstacle Detection"),
            (speed_fog, "Fog / Low Visibility (DFRI)"),
            (speed_terrain, "Hairpin Switchback"),
            (speed_v2v, "V2V Safety Advisory"),
        ]
        min_speed, bottleneck = min(all_limits, key=lambda x: x[0])
        final_safe_speed = round(min_speed, 1)

        # Action determination
        if final_safe_speed == 0.0:
            status = "CRITICAL"
            action = "STOP"
            emergency = True
        elif current_speed_kmh > final_safe_speed + 2.0:
            status = "CAUTION"
            action = "SLOW DOWN"
            emergency = False
        else:
            status = "NORMAL"
            action = "MAINTAIN"
            emergency = False

        return {
            "vehicle_id": self.vehicle_id,
            "final_safe_speed_kmh": final_safe_speed,
            "status": status,
            "action": action,
            "emergency": emergency,
            "bottleneck": bottleneck,
            "active_v2v_alert": active_v2v_alert,
            "limits": {
                "obstacle": speed_obs,
                "fog": speed_fog,
                "terrain": speed_terrain,
                "v2v": speed_v2v
            }
        }
