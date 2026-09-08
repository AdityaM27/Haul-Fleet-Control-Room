# Resurgence Fleet Control Room 2.0 — 6-Truck Autonomous & Hardware Twin

A modern real-time Control Room and Digital Twin dashboard designed for monitoring a fleet of 6 haul trucks with dynamic risk scoring, fog-resilient vision, 4-zone fog heatmaps, 10-minute predictive fog forecasting, and live ESP32 + GPS hardware prototyping.

---

## What's New in 2.0

1. **Simplified Industrial Naming**:
   - `Truck 1` through `Truck 6` (`TRUCK_01` to `TRUCK_06`).
   - Backward-compatible with previous IDs (`HAUL_01`, `DUMPER_01`, `PROTOTYPE_1`).

2. **Control Panel: All Truck Locations Button**:
   - Located directly **above the truck list** in the sidebar.
   - Clicking **`🗺️ ALL TRUCK LOCATIONS (CONTROL PANEL)`** shows the full fleet layout and all 4 fog zones at a glance on the Leaflet map.
   - Clicking any specific truck in the list or on the map focuses directly onto that truck's position and telemetry.

3. **Real vs. Simulation Segregation (ESP32 + GPS Module)**:
   - Filter tabs: `[ ALL (6) ]`, `[ 🟢 REAL ESP32 ]`, `[ 🔷 SIMULATION ]`.
   - `Truck 1` is designated as the **Hardware Prototype Ready** node.
   - Toggle button on the dashboard: **`Switch to Autonomous Simulation`** / **`Bind to Real ESP32 Prototype`**.
   - When receiving live packets from your ESP32 + GPS module via `POST /update`, the dashboard displays a live connection badge, packet count, and coordinates.

4. **Real-Time Risk Score for Every Vehicle (0–100)**:
   - Dynamic formula combining 4 risk factors:
     - **Speed Risk**: Compared against the current zone's maximum safe fog speed.
     - **Fog Exposure**: Calculated inversely to zone visibility in meters.
     - **Traffic Proximity**: Haversine distance to the nearest other truck in the mine.
     - **Road Hazard Clearance**: Front obstacle distance from the ultrasonic sensor.
   - Breakdown progress bars displayed on the dashboard with risk level: `LOW`, `MODERATE`, `HIGH`, `CRITICAL`.

5. **Dynamic Fog Zones & Heatmap on Leaflet**:
   - The open-pit quarry is divided into 4 zones:
     - **Zone 1: Pit Bottom & Loading Bay** (18m visibility — `SEVERE FOG`, max 10 km/h)
     - **Zone 2: North Switchback Haulway** (42m visibility — `LOW VISIBILITY`, max 18 km/h)
     - **Zone 3: Waste Dump Ridge** (85m visibility — `CAUTION`, max 25 km/h)
     - **Zone 4: Primary Crusher Basin** (145m visibility — `NORMAL`, max 40 km/h)
   - Real-time geofencing: Each truck automatically identifies which zone it is inside and adapts its speed governor.

6. **10-Minute Fog Predictive Engine**:
   - Uses ambient temperature, relative humidity, dew point, and wind vectors.
   - Predicts whether visibility will worsen in the next 10 minutes (e.g. `Zone 1: 18m -> 12m Critical Fog; Valley Inversion`) and alerts the control room in advance.

---

## Quick Start

### 1. Run the Control Room Server
```bash
python server.py
```
Server runs on `http://localhost:5000` (or `http://<your-laptop-ip>:5000`).

### 2. Access the Dashboard
Open your browser and navigate to:
```
http://localhost:5000
```

### 3. ESP32 + GPS Integration (Hardware Demonstration)
Make sure your ESP32 is connected to the same Wi-Fi network as this laptop, and POST JSON telemetry to:
`http://<laptop-ip>:5000/update`

Payload format:
```json
{
  "vehicle_id": "TRUCK_01",
  "dist_front": 12,
  "dist_left": 140,
  "dist_right": 155,
  "lat": 17.3849,
  "lng": 78.4865,
  "speed": 14.5,
  "gps_valid": true
}
```

---

## Testing Tools

### Test Simulator Script
To simulate your ESP32 sending packets to Truck 1 while the rest of the fleet is simulated:
```bash
python simulator_standalone.py
```
Select `[1]` to simulate the ESP32 prototype node, or `[2]` to simulate external packets for all 6 trucks.
