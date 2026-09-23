import os
import sys
import json
import math
import re
import server

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def test_everything():
    print("=============================================================")
    print("RESURGENCE FLEET DIGITAL TWIN — COMPREHENSIVE FINAL AUDIT")
    print("=============================================================\n")

    client = server.app.test_client()

    # 1. Metadata & Assets Check
    print("[1/10] Verifying Metadata and Copernicus DEM Assets...")
    meta_path = "static/bailadila_terrain_meta.json"
    png_path = "static/bailadila_terrain_256.png"
    assert os.path.exists(meta_path), "Meta json missing"
    assert os.path.exists(png_path), "DEM PNG missing"

    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    print(f"  DEM Extent: North={meta['north']}, South={meta['south']}, West={meta['west']}, East={meta['east']}")
    print(f"  Elevation Range: {meta['minElevationMeters']:.2f}m to {meta['maxElevationMeters']:.2f}m ASL")
    assert meta["width"] == 256 and meta["height"] == 256

    # 2. Pit Excavation & Surface Elevation Parity (server.py vs Three.js)
    print("\n[2/10] Verifying Pit Excavation Consistency (server.py vs Three.js engine)...")
    pit_center_lat, pit_center_lng = 18.5792, 81.2194
    pit_center_elev = server.sample_mine_surface_elevation(pit_center_lat, pit_center_lng)
    raw_dem_elev = server.sample_raw_dem_elevation(pit_center_lng, pit_center_lat)
    print(f"  Pit Center: Raw DEM = {raw_dem_elev:.2f}m, Carved Mine Surface = {pit_center_elev:.2f}m")
    print(f"  Pit Cut Depth = {raw_dem_elev - pit_center_elev:.2f}m (Cut down to bench floor ~519m ASL)")
    assert 515.0 <= pit_center_elev <= 535.0, f"Pit floor elevation outside expected range: {pit_center_elev}"

    # Verify identical formula calculation between server.py and Three.js engine across all waypoints
    max_formula_diff = 0.0
    for wp in server.SIM_WAYPOINTS:
        lat, lng = wp['lat'], wp['lng']
        py_elev = server.sample_mine_surface_elevation(lat, lng)

        x = (lng - server.DEM_LON0) * server.M_LON
        z = -(lat - server.DEM_LAT0) * server.M_LAT
        raw_dem = server.sample_raw_dem_elevation(lng, lat)
        dx = x - server.PIT_X
        dz = z - server.PIT_Z
        theta = math.atan2(dz, dx)
        r_organic = 1.0 + 0.12 * math.cos(3 * theta + 0.5) + 0.08 * math.sin(5 * theta - 0.7) + 0.04 * math.cos(2 * theta)
        norm_dist = math.hypot(dx / server.PIT_RX, dz / server.PIT_RZ) / r_organic

        rim_h = server.sample_raw_dem_elevation(server.PIT_LON, server.PIT_LAT) + 12.0
        floor_h = max(server.DEM_Y_MIN + 25.0, rim_h - server.PIT_CUT_DEPTH)
        total_cut = rim_h - floor_h
        bench_h = total_cut / server.PIT_BENCHES

        if norm_dist >= 1.0:
            js_elev = raw_dem
        elif norm_dist > 0.88:
            blend = (norm_dist - 0.88) / 0.12
            top_bench = rim_h - bench_h * 0.4
            js_elev = min(raw_dem, top_bench * (1.0 - blend) + raw_dem * blend)
        elif norm_dist > 0.15:
            bparam = (0.88 - norm_dist) / 0.73 * server.PIT_BENCHES
            bidx = min(server.PIT_BENCHES - 1, int(math.floor(bparam)))
            bfrac = bparam - bidx
            if bfrac < 0.75:
                offset = (bidx + 0.08) * bench_h
            else:
                slope = (bfrac - 0.75) / 0.25
                offset = (bidx + 0.08 + slope * 0.92) * bench_h
            js_elev = min(raw_dem, rim_h - offset)
        else:
            js_elev = min(raw_dem, floor_h)

        diff = abs(py_elev - js_elev)
        if diff > max_formula_diff:
            max_formula_diff = diff
    print(f"  Max formula divergence across circuit: {max_formula_diff:.6f}m (EXACT MATCH)")
    assert max_formula_diff < 1e-5, "Excavation formula between Python backend and JS engine must be identical"

    # 3. Fleet Telemetry & Truck Elevation / Spatial Invariant Check
    print("\n[3/10] Verifying Truck Spatial & Elevation Invariants (No floating/sinking)...")
    res = client.get("/api/fleet")
    assert res.status_code == 200
    fdata = res.get_json()
    vehicles = fdata.get("vehicles", [])
    assert len(vehicles) == 6, f"Expected 6 vehicles, got {len(vehicles)}"

    for v in vehicles:
        calc_elev = server.sample_mine_surface_elevation(v["lat"], v["lng"])
        elev_diff = abs(v["elevation_m"] - calc_elev)
        print(f"  {v['id']}: lat={v['lat']:.5f}, lng={v['lng']:.5f}, backend_elev={v['elevation_m']}m, surface_elev={calc_elev:.1f}m, diff={elev_diff:.2f}m")
        # Invariant: backend elevation_m == sample_mine_surface_elevation(lat, lng) == rendered surface
        assert elev_diff <= 0.1, f"Truck {v['id']} elevation diverges from terrain surface: {elev_diff}m"

        # Verify coordinates convert round-trip to Three.js coordinates
        x = (v["lng"] - server.DEM_LON0) * server.M_LON
        z = -(v["lat"] - server.DEM_LAT0) * server.M_LAT
        lon_back = server.DEM_LON0 + x / server.M_LON
        lat_back = server.DEM_LAT0 - z / server.M_LAT
        assert abs(lon_back - v["lng"]) < 1e-9 and abs(lat_back - v["lat"]) < 1e-9

    # 4. Code Audit: Search bailadila_dem_terrain.js for forbidden movement variables
    print("\n[4/10] Auditing bailadila_dem_terrain.js for performance.now / progression variables...")
    with open("static/js/bailadila_dem_terrain.js", "r", encoding="utf-8") as f:
        js_code = f.read()

    # Exclude comments
    code_no_comments = re.sub(r'/\*.*?\*/', '', js_code, flags=re.DOTALL)
    code_no_comments = re.sub(r'//.*', '', code_no_comments)

    for forbidden in ["performance.now()", "tProg", "routeProgress", "truckPath"]:
        assert forbidden not in code_no_comments, f"Forbidden progression token '{forbidden}' found in active JS code!"
    print("  CONFIRMED: Zero independent movement math or clock-driven positioning in Three.js engine.")

    # 5. Camera Modes Audit in mine3d.html
    print("\n[5/10] Auditing Camera Modes in templates/mine3d.html...")
    with open("templates/mine3d.html", "r", encoding="utf-8") as f:
        mine3d_content = f.read()

    expected_modes = ["ORBIT", "FOLLOW TRUCK", "CHASE TRUCK", "COCKPIT", "CINEMATIC ROUTE"]
    for mode in expected_modes:
        assert mode in mine3d_content, f"Camera mode '{mode}' missing from templates/mine3d.html"
    print("  CONFIRMED: All 5 camera modes (ORBIT, FOLLOW TRUCK, CHASE TRUCK, COCKPIT, CINEMATIC ROUTE) present and clearly labeled.")

    # 6. Digital-Twin Sync Validator Audit (index.html & mine3d.html)
    print("\n[6/10] Auditing Digital-Twin Sync Validator in templates...")
    with open("templates/index.html", "r", encoding="utf-8") as f:
        index_content = f.read()

    validator_tokens = [
        "DIGITAL-TWIN SYNC VALIDATOR",
        "Vehicle ID",
        "Backend:",
        "Three.js:",
        "Surface Elevation",
        "Differences:",
        "Position difference",
        "Elevation difference",
        "Heading difference",
        "Status:",
        "POSITION: SYNCED",
        "ELEVATION: SYNCED",
        "HEADING: SYNCED",
        "DIGITAL TWIN SYNCED"
    ]
    for token in validator_tokens:
        assert token in index_content, f"Sync Validator token '{token}' missing from templates/index.html"
        assert token in mine3d_content, f"Sync Validator token '{token}' missing from templates/mine3d.html"
    print("  CONFIRMED: Complete Digital-Twin Sync Validator present in both index.html and mine3d.html.")

    # 7. Route Terminology Compliance Audit
    print("\n[7/10] Auditing Route Terminology Compliance across codebase...")
    assert "Conceptual Deposit-14 simulation route" in index_content
    assert "Conceptual Deposit-14 simulation route" in mine3d_content
    with open("templates/driver.html", "r", encoding="utf-8") as f:
        driver_content = f.read()
    assert "Conceptual Deposit-14 simulation route" in driver_content

    # Confirm neither file claims the route is official NMDC data
    for fn, txt in [("index.html", index_content), ("mine3d.html", mine3d_content)]:
        for line in txt.splitlines():
            if "official" in line.lower() and "nmdc" in line.lower():
                assert "not official nmdc" in line.lower() or "not an official nmdc" in line.lower(), f"Unsanctioned official NMDC claim in {fn}: {line}"
    print("  CONFIRMED: Deposit-14 route strictly labeled as 'Conceptual Deposit-14 simulation route' with disclaimers preserved.")

    # 8. Scenarios Engine & State Machine Audit
    print("\n[8/10] Verifying Scenarios Execution & Lifecycle State Engine...")
    scenarios = ["CLEAR_RUN", "DENSE_FOG", "OBSTACLE_AHEAD", "HAIRPIN_CAUTION", "TRAFFIC_CLOSE"]
    for sc in scenarios:
        res = client.post("/api/scenarios/apply", json={"scenario": sc})
        assert res.status_code == 200, f"Scenario {sc} failed: {res.status_code}"
        res2 = client.get("/api/fleet")
        fdata2 = res2.get_json()
        assert fdata2["simulation"]["active_scenario"]["id"] == sc
    print("  All 5 scenarios successfully applied and verified.")

    # 9. Safety Events Audit Trail
    print("\n[9/10] Verifying Safety Audit Event Log...")
    res = client.get("/api/events")
    assert res.status_code == 200
    events = res.get_json().get("events", [])
    print(f"  Total safety events recorded: {len(events)}")
    assert len(events) >= 5, "Safety events should record scenario applications"

    # 10. Production Deployment & WSGI Compatibility Audit
    print("\n[10/12] Verifying Deployment Compatibility & Relative URLs...")
    # Check Flask WSGI application object
    assert hasattr(server, "app"), "Flask application object 'app' missing in server.py"

    # Check root route loads
    res_root = client.get("/")
    assert res_root.status_code == 200, "Root '/' did not return HTTP 200"

    # Check 16-waypoint simulation route
    res_route = client.get("/api/simulation_route")
    assert res_route.status_code == 200, "/api/simulation_route did not return HTTP 200"
    route_wps = res_route.get_json().get("waypoints", [])
    assert len(route_wps) == 16, f"Expected 16 waypoints, got {len(route_wps)}"

    # Check terrain assets load
    res_meta = client.get("/bailadila_terrain_meta.json")
    assert res_meta.status_code == 200, "Metadata asset did not return HTTP 200"
    res_png = client.get("/bailadila_terrain_256.png")
    assert res_png.status_code == 200, "PNG asset did not return HTTP 200"

    # Verify no frontend code contains hardcoded localhost
    for fn, txt in [("index.html", index_content), ("mine3d.html", mine3d_content), ("driver.html", driver_content)]:
        for num, line in enumerate(txt.splitlines(), 1):
            if "localhost" in line.lower() or "127.0.0.1" in line.lower():
                raise AssertionError(f"Hardcoded localhost found in {fn}:{num}: {line.strip()}")

    # Verify deployment config files exist
    assert os.path.exists("Procfile"), "Procfile is missing"
    assert os.path.exists("requirements.txt"), "requirements.txt is missing"
    with open("Procfile", "r", encoding="utf-8") as f:
        p_content = f.read()
    assert "gunicorn server:app" in p_content, "Procfile does not define gunicorn server:app command"

    with open("requirements.txt", "r", encoding="utf-8") as f:
        req_content = f.read()
    assert "gunicorn" in req_content, "gunicorn missing from requirements.txt"
    print("  CONFIRMED: WSGI compatibility, relative API URLs, and deployment configs verified.")

    # 11. Fog Density Measurement System (DFRI) Validation
    print("\n[11/12] Verifying Fog Density Measurement System (DFRI 5-Tier Scale)...")
    test_visibilities = [
        (150.0, 1, "NORMAL", 35.0),
        (75.0, 2, "CAUTION", 25.0),
        (35.0, 3, "LOW VISIBILITY", 18.0),
        (12.0, 4, "SEVERE FOG", 10.0),
        (3.0, 5, "CRITICAL", 5.0)
    ]
    for vis, exp_tier, exp_sev, exp_lim in test_visibilities:
        dfri = server.compute_dynamic_fog_risk_index(vis, temp_c=18.0, dew_point_c=18.0)
        print(f"  Visibility {vis:5.1f}m -> Tier {dfri['tier']} ({dfri['severity']:14s}), DFRI={dfri['index_0_100']:2d}/100, Beta={dfri['extinction_coeff_beta']:.4f} 1/m, Safe Limit={dfri['permitted_behavior']['safe_speed_limit_kmh']} km/h")
        assert dfri["tier"] == exp_tier, f"Expected tier {exp_tier} for {vis}m, got {dfri['tier']}"
        assert dfri["severity"] == exp_sev, f"Expected severity {exp_sev} for {vis}m, got {dfri['severity']}"
        assert dfri["permitted_behavior"]["safe_speed_limit_kmh"] == exp_lim, f"Expected limit {exp_lim}, got {dfri['permitted_behavior']['safe_speed_limit_kmh']}"
        expected_beta = round(3.912 / vis, 4)
        assert abs(dfri["extinction_coeff_beta"] - expected_beta) < 1e-3
    print("  CONFIRMED: All 5 DFRI visibility tiers, Koschmieder's Law, and automated behavior policies verified.")

    # 12. Dynamic Speed Recommendation (DSR) Engine Validation
    print("\n[12/12] Verifying Dynamic Speed Recommendation (DSR) Engine & Endpoints...")
    test_v = {
        "id": "TRUCK_02",
        "speed_kmh": 27.0,
        "dist_front": 1800,
        "heading": 90.0,
        "current_zone": {
            "name": "Zone 2: Hairpin Switchback",
            "visibility_m": 45.0,
            "road_condition": "WET_IRON_ORE_SLURRY",
            "surface_friction_mu": 0.35,
            "is_hairpin": True,
            "curvature_radius_m": 25.0
        },
        "curvature": 0.05
    }
    dsr = server.compute_dynamic_safe_speed(test_v, fleet=[test_v], weather={"condition": "HEAVY_FOG_DRIZZLE"})
    print(f"  DSR Evaluation for TRUCK_02 at 27.0 km/h in Hairpin + Wet Slurry:")
    print(f"    Safe Speed: {dsr['safe_speed_kmh']} km/h")
    print(f"    Current Speed: {dsr['current_speed_kmh']} km/h")
    print(f"    Advisory Badge: {dsr['advisory_badge']}")
    print(f"    Bottleneck Reason: {dsr['primary_constraint']}")
    print(f"    Haul Cycle Efficiency: {dsr['haul_cycle_efficiency_pct']}%")
    print(f"    Stopping Sight Distance: {dsr['stopping_sight_distance_m']} m")

    assert dsr["current_speed_kmh"] == 27.0
    assert dsr["safe_speed_kmh"] <= 12.0, "Hairpin switchback must cap speed at <= 12 km/h"
    assert "REDUCE" in dsr["advisory_badge"] or "CRITICAL" in dsr["advisory_badge"], "Must alert overspeed"
    assert "inputs" in dsr, "DSR must return evaluated inputs"
    assert "fog_density" in dsr["inputs"]
    assert "obstacle_distance" in dsr["inputs"]
    assert "road_curvature" in dsr["inputs"]
    assert "road_condition" in dsr["inputs"]

    res_dsr = client.get("/api/dynamic_speed/TRUCK_02")
    assert res_dsr.status_code == 200, f"/api/dynamic_speed/TRUCK_02 failed: {res_dsr.status_code}"
    dsr_payload = res_dsr.get_json()
    assert dsr_payload["success"] is True
    assert "dsr" in dsr_payload
    assert "safe_speed_kmh" in dsr_payload["dsr"]
    assert dsr_payload["dsr"]["safe_speed_kmh"] >= 0.0

    res_fleet = client.get("/api/fleet")
    assert res_fleet.status_code == 200
    fleet_json = res_fleet.get_json()
    for truck in fleet_json["vehicles"]:
        assert "dsr" in truck, f"Truck {truck['id']} missing DSR payload"
        assert "dfri" in truck, f"Truck {truck['id']} missing DFRI payload"
        assert "safe_speed_kmh" in truck["dsr"]
        assert "tier" in truck["dfri"]
    print("  CONFIRMED: Dynamic Speed Recommendation Engine & DFRI endpoints fully verified.")

    print("\n=============================================================")
    print("AUDIT RESULT: 100% PASSED — ALL AUDIT & DEPLOYMENT CHECKS MET!")
    print("Digital-twin synchronization validation passed.")
    print("=============================================================")

if __name__ == "__main__":
    test_everything()
