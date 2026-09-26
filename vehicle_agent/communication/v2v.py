"""
V2V Communication Edge Module (Section 4, 5, 13)
Direct Peer-to-Peer Safety Transceiver for Mining Haulers
"""

import time
from typing import Dict, Any, List
import v2v_engine

class V2VEdgeTransceiver:
    def __init__(self, vehicle_id: str, transport: v2v_engine.V2VTransport = None):
        self.vehicle_id = vehicle_id
        self.transport = transport or v2v_engine.v2v_engine.transport
        self.active_neighbors: List[Dict[str, Any]] = []
        self.received_alerts: List[Dict[str, Any]] = []

    def broadcast_status(self, lat: float, lng: float, alt: float,
                         speed_kmh: float, heading: float,
                         status: str, safe_speed: float) -> dict:
        """Transmits Section 4 compact V2V_STATUS beacon."""
        msg = {
            "message_type": "V2V_STATUS",
            "sender_id": self.vehicle_id,
            "timestamp": round(time.time(), 3),
            "position": {
                "latitude": round(lat, 6),
                "longitude": round(lng, 6),
                "altitude": round(alt, 1)
            },
            "motion": {
                "speed_kmh": round(speed_kmh, 1),
                "heading_deg": round(heading, 1)
            },
            "vehicle_status": status,
            "hazard": {
                "active": False,
                "type": None,
                "severity": None,
                "distance_m": None
            },
            "safe_speed_kmh": round(safe_speed, 1),
            "rtk_status": "FIX"
        }
        self.transport.broadcast(msg, self.vehicle_id)
        return msg

    def broadcast_hazard(self, hazard_type: str, severity: str,
                         lat: float, lng: float, distance_m: float = 10.0,
                         rec_action: str = "STOP_OR_SLOW",
                         ttl: float = 5.0) -> dict:
        """Transmits Section 5 V2V_HAZARD_ALERT."""
        alert = {
            "message_type": "V2V_HAZARD_ALERT",
            "sender_id": self.vehicle_id,
            "timestamp": round(time.time(), 3),
            "hazard_type": hazard_type,
            "severity": severity,
            "hazard_position": {
                "latitude": round(lat, 6),
                "longitude": round(lng, 6)
            },
            "hazard_distance_m": round(distance_m, 1),
            "recommended_action": rec_action,
            "ttl_seconds": ttl
        }
        self.transport.broadcast(alert, self.vehicle_id)
        return alert

    def poll_messages(self) -> List[Dict[str, Any]]:
        """Polls inbox from the active V2V transport layer."""
        msgs = self.transport.receive_messages(self.vehicle_id)
        valid_msgs = []
        for m in msgs:
            is_valid, _ = v2v_engine.V2VMessageValidator.validate(m)
            if is_valid:
                valid_msgs.append(m)
        return valid_msgs
