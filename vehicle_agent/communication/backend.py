"""
Central Fleet Backend Telemetry Client
Periodically transmits full vehicle telemetry to Flask Control Room
"""

import json
import urllib.request
from typing import Dict, Any, Optional

class BackendClient:
    def __init__(self, base_url: str = "http://127.0.0.1:5000"):
        self.base_url = base_url.rstrip("/")

    def send_telemetry(self, vehicle_dict: Dict[str, Any]) -> bool:
        """Sends vehicle telemetry payload to backend /update route."""
        url = f"{self.base_url}/update"
        try:
            req_data = json.dumps(vehicle_dict).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=req_data,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                return resp.status == 200
        except Exception:
            return False

    def fetch_fleet_state(self) -> Optional[Dict[str, Any]]:
        """Retrieves authoritative world state from /api/fleet."""
        url = f"{self.base_url}/api/fleet"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "VehicleAgent/1.0"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode("utf-8"))
        except Exception:
            pass
        return None
