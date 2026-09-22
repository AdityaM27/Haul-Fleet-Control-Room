import os
import json
import math
import subprocess
import server

def test_everything():
    print("=============================================================")
    print("RESURGENCE FLEET DIGITAL TWIN — FULL SYSTEM VERIFICATION")
    print("=============================================================\n")

    client = server.app.test_client()

    # 1. Metadata & Assets Check
    print("[1/6] Verifying Metadata and DEM Assets...")
    meta_path = "static/bailadila_terrain_meta.json"
    png_path = "static/bailadila_terrain_256.png"
    assert os.path.exists(meta_path), "Meta json missing"
    assert os.path.exists(png_path), "DEM PNG missing"

    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    print(f"  DEM Extent: North={meta['north']}, South={meta['south']}, West={meta['west']}, East={meta['east']}")
    print(f"  Elevation Range: {meta['minElevationMeters']:.2f}m to {meta['maxElevationMeters']:.2f}m ASL")
    assert meta["width"] == 256 and meta["height"] == 256

    # 2. Authoritative Surface Elevation Check
    print("\n[2/6] Verifying Authoritative Surface Elevation Engine...")
    pit_center_lat, pit_center_lng = 18.5792, 81.2194
    pit_center_elev = server.sample_mine_surface_elevation(pit_center_lat, pit_center_lng)
    raw_dem_elev = server.sample_raw_dem_elevation(pit_center_lng, pit_center_lat)
    print(f"  Pit Center: Raw DEM = {raw_dem_elev:.2f}m, Carved Mine Surface = {pit_center_elev:.2f}m")
    print(f"  Pit Cut Depth = {raw_dem_elev - pit_center_elev:.2f}m (Cut down to bench floor ~519m ASL)")
    assert 515.0 <= pit_center_elev <= 535.0, f"Pit floor elevation outside expected range: {pit_center_elev}"

    # Outside pit check (Deposit 11 / ridge crest)
    ridge_elev = server.sample_mine_surface_elevation(18.6750, 81.2285)
    ridge_raw = server.sample_raw_dem_elevation(81.2285, 18.6750)
    print(f"  Ridge Peak (18.6750, 81.2285): Surface = {ridge_elev:.2f}m, Raw DEM = {ridge_raw:.2f}m")
    assert abs(ridge_elev - ridge_raw) < 0.1, "Outside pit elevation should match raw DEM"

    # 3. Canonical 16-Waypoint Route Check
    print("\n[3/6] Verifying Canonical 16-Waypoint Route Loop...")
    res = client.get("/api/simulation_route")
    assert res.status_code == 200
    rdata = res.get_json()
    waypoints = rdata.get("waypoints", [])
    print(f"  Waypoints received: {len(waypoints)}")
    assert len(waypoints) == 16, f"Expected 16 waypoints, got {len(waypoints)}"
    
    # Verify elevations along waypoints
    for i, wp in enumerate(waypoints):
        calc_elev = server.sample_mine_surface_elevation(wp["lat"], wp["lng"])
        print(f"  WP {i:02d} ({wp['name']}): lat={wp['lat']:.4f}, lng={wp['lng']:.4f}, surface_elev={calc_elev:.1f}m ASL")
        assert 500.0 <= calc_elev <= 1100.0, f"WP {i} elevation out of range: {calc_elev}"

    # 4. 6-Truck Fleet Simulation Telemetry Check
    print("\n[4/6] Verifying 6-Truck Telemetry & Deterministic Lifecycle...")
    res = client.get("/api/fleet")
    assert res.status_code == 200
    fdata = res.get_json()
    vehicles = fdata.get("vehicles", [])
    assert len(vehicles) == 6, f"Expected 6 vehicles, got {len(vehicles)}"

    for v in vehicles:
        print(f"  {v['id']}: stage={v['lifecycle_state']}, speed={v['speed_kmh']:.1f}km/h, elev={v['elevation_m']}m, action={v['action']}, risk={v['risk_score']['total'] if v.get('risk_score') else 'N/A'}")
        assert v["elevation_m"] is not None and v["elevation_m"] > 0
        assert v["heading"] is not None and 0 <= v["heading"] <= 360

    # 5. Scenarios Engine Check
    print("\n[5/6] Verifying Scenarios Execution...")
    scenarios = ["CLEAR_RUN", "DENSE_FOG", "OBSTACLE_AHEAD", "HAIRPIN_CAUTION", "TRAFFIC_CLOSE"]
    for sc in scenarios:
        res = client.post("/api/scenarios/apply", json={"scenario": sc})
        assert res.status_code == 200, f"Scenario {sc} failed: {res.status_code}"
        res2 = client.get("/api/fleet")
        fdata2 = res2.get_json()
        assert fdata2["simulation"]["active_scenario"]["id"] == sc
    print("  All 5 scenarios successfully applied and reflected in active simulation state.")

    # 6. Safety Events Audit Trail Check
    print("\n[6/6] Verifying Safety Audit Event Log...")
    res = client.get("/api/events")
    assert res.status_code == 200
    events = res.get_json().get("events", [])
    print(f"  Total safety events recorded: {len(events)}")
    assert len(events) >= 5, "Safety events should record scenario applications"

    print("\n=============================================================")
    print("SUCCESS: ALL SYSTEM INVARIANTS AND SPECIFICATIONS VERIFIED!")
    print("=============================================================")

if __name__ == "__main__":
    test_everything()
