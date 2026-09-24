/**
 * BAILADILA RANGE — 3D DEM TERRAIN & CONCEPTUAL OPEN-PIT DIGITAL TWIN ENGINE
 * 
 * Powered by Copernicus GLO-30 DEM 16-bit heightmap (256x256).
 * Aligned to real geographic coordinates (Kirandul & Deposit-14, Dantewada District, Chhattisgarh).
 * 
 * Complies with strict engineering digital-twin requirements:
 * - Real DEM elevation variation (219.97m to 1272.35m ASL)
 * - Georeferenced WGS84 projection (Longitude -> X, Latitude -> Z)
 * - Organic carved-in conceptual open-pit excavation with stepped benches & safety berms
 * - Terrain-following haul roads with realistic switchbacks
 * - Procedural high-detail mining dump trucks (CAT/NMDC yellow, 6 wheels, cab, bed, grille)
 * - Fog-Guard integration & terrain-aware hazard layers
 */

(function(global) {
  'use strict';

  // Default fallback metadata (Copernicus GLO-30 DEM Bailadila Region)
  const DEFAULT_META = {
    width: 256,
    height: 256,
    south: 18.500138899999996,
    north: 18.750138899999996,
    west: 81.14986109999998,
    east: 81.26986109999999,
    minElevationMeters: 219.96580505371094,
    maxElevationMeters: 1272.3497314453125,
    source: "Copernicus GLO-30 DEM",
    sourceFile: "bailadila_dem_30m.tif",
    crs: "EPSG:4326"
  };

  // Known geodetic coordinates for Bailadila mining complexes
  const LANDMARKS = {
    BACHELI: { name: 'Bacheli Complex', lat: 18.7042, lon: 81.2111, type: 'plant' },
    KIRANDUL: { name: 'Kirandul Complex', lat: 18.5867, lon: 81.2228, type: 'complex' },
    DEPOSIT_14: { name: 'Deposit 14 (Pit)', lat: 18.5792, lon: 81.2194, type: 'pit' },
    DEPOSIT_13: { name: 'Deposit 13 Crest', lat: 18.6012, lon: 81.2265, type: 'ore' },
    DEPOSIT_11: { name: 'Deposit 11 Ridge', lat: 18.6280, lon: 81.2310, type: 'ore' },
    DEPOSIT_5:  { name: 'Deposit 5 Crest', lat: 18.7250, lon: 81.2450, type: 'ore' },
    PEAK_1272:  { name: 'Bailadila High Peak (1272m)', lat: 18.6750, lon: 81.2285, type: 'peak' }
  };

  // Canonical 16-waypoint Deposit-14 simulation circuit (authoritative simulation track)
  const CANONICAL_DEPOSIT_14_WAYPOINTS = [
    { id: "KIRANDUL_YARD", lat: 18.5928, lng: 81.2215, name: "Kirandul Dispatch Yard" },
    { id: "RIM_NORTH", lat: 18.5918, lng: 81.2250, name: "Deposit 14 North Rim" },
    { id: "RAMP_EAST_1", lat: 18.5898, lng: 81.2270, name: "East Ramp Upper Bench" },
    { id: "HAIRPIN_E1", lat: 18.5876, lng: 81.2264, name: "East Hairpin 1" },
    { id: "BENCH_MID_E", lat: 18.5858, lng: 81.2250, name: "East Middle Bench" },
    { id: "HAIRPIN_E2", lat: 18.5839, lng: 81.2262, name: "East Hairpin 2" },
    { id: "SOUTH_RIM", lat: 18.5818, lng: 81.2248, name: "Deposit 14 South Rim" },
    { id: "PIT_SOUTH_BENCH", lat: 18.5805, lng: 81.2226, name: "Lower South Bench" },
    { id: "PIT_FLOOR", lat: 18.5792, lng: 81.2194, name: "Deposit 14 Pit Floor" },
    { id: "LOADING_BAY", lat: 18.5801, lng: 81.2174, name: "Ore Loading Bay" },
    { id: "WEST_LOWER", lat: 18.5821, lng: 81.2158, name: "West Lower Bench" },
    { id: "HAIRPIN_W1", lat: 18.5840, lng: 81.2148, name: "West Hairpin 1" },
    { id: "WEST_MID", lat: 18.5861, lng: 81.2158, name: "West Middle Bench" },
    { id: "HAIRPIN_W2", lat: 18.5878, lng: 81.2147, name: "West Hairpin 2" },
    { id: "NORTHWEST_BENCH", lat: 18.5898, lng: 81.2165, name: "Northwest Upper Bench" },
    { id: "RAMP_NORTH", lat: 18.5912, lng: 81.2188, name: "North Access Ramp" }
  ];

  class BailadilaTerrainEngine {
    constructor() {
      this.meta = Object.assign({}, DEFAULT_META);
      this.rawElev = null; // Float32Array(256 * 256)
      this.isLoaded = false;
      this.vscale = 1.0;
      this.showPit = true;
      this.showTerrain = true;
      this.showRoads = true;
      this.showTrucks = true;
      this.showHazards = true;

      // Coordinate scaling constants
      this.lat0 = (this.meta.north + this.meta.south) / 2.0;
      this.lon0 = (this.meta.east + this.meta.west) / 2.0;
      this.M_LAT = 111320.0; // meters per degree latitude
      this.M_LON = 111320.0 * Math.cos(this.lat0 * Math.PI / 180.0); // meters per degree longitude
      this.yMin = this.meta.minElevationMeters;

      // Pit parameters (Deposit 14 / Kirandul flank)
      this.pitCenter = { lon: 81.2194, lat: 18.5792 };
      this.pitPos = this.lonLatToWorld(this.pitCenter.lon, this.pitCenter.lat, 0);
      this.pitRX = 1380.0; // meters east-west radius
      this.pitRZ = 1120.0; // meters north-south radius
      this.pitBenches = 10;
      this.pitCutDepth = 225.0; // total cut depth in meters

      // Shared meshes and curve points
      this.terrainMesh = null;
      this.pitExcavationMesh = null;
      this.roadGroup = null;
      this.truckGroup = null;
      this.hazardGroup = null;
      this.landmarkGroup = null;
      this.roadCurvePoints = [];
      this.sampledRoad = [];
      this.truckObjects = {};

      // Multi-layer Haul Road & Vehicle Trails System
      this.selectedVehicleId = 'TRUCK_01';
      this.trailHistory = {}; // vId -> array of Vector3 positions
      this.trailMeshes = {}; // vId -> Mesh
      this.roadBaseMesh = null;
      this.roadCenterlineMesh = null;
      this.directionArrowsMesh = null;
      this.activeRouteMesh = null;
      this.hazardRoadMesh = null;
      this.hazardRoadMat = null;
      this.trailsGroup = null;
      this.roadCurve = null;
      this.sampledNormals = [];
      this.sampledTangents = [];
      this.sampledWidths = [];
      this.trailsDirty = true;

      this._initProjections();
    }

    _initProjections() {
      this.lat0 = (this.meta.north + this.meta.south) / 2.0;
      this.lon0 = (this.meta.east + this.meta.west) / 2.0;
      this.M_LAT = 111320.0;
      this.M_LON = 111320.0 * Math.cos(this.lat0 * Math.PI / 180.0);
      this.yMin = this.meta.minElevationMeters;
      this.pitPos = this.lonLatToWorld(this.pitCenter.lon, this.pitCenter.lat, 0);
    }

    /**
     * Map (lon, lat, elevMeters) to local Three.js coordinates (X, Y, Z).
     * Center of DEM is (0, 0).
     * Longitude -> +X (East)
     * Latitude  -> -Z (North is -Z, South is +Z)
     * Elevation -> +Y (Up, scaled by vscale)
     */
    lonLatToWorld(lon, lat, elevMeters, vscale) {
      const vs = (vscale !== undefined) ? vscale : this.vscale;
      const x = (lon - this.lon0) * this.M_LON;
      const z = -(lat - this.lat0) * this.M_LAT;
      const y = (elevMeters - this.yMin) * vs;
      return { x, y, z };
    }

    worldToLonLat(x, z) {
      const lon = this.lon0 + x / this.M_LON;
      const lat = this.lat0 - z / this.M_LAT;
      return { lon, lat };
    }

    /**
     * Load metadata and 16-bit DEM heightmap.
     */
    async load(metaUrl = '/static/bailadila_terrain_meta.json', pngUrl = '/static/bailadila_terrain_256.png') {
      try {
        // 1. Fetch metadata
        const metaRes = await fetch(metaUrl).catch(() => fetch('/bailadila_terrain_meta.json'));
        if (metaRes && metaRes.ok) {
          const loadedMeta = await metaRes.json();
          this.meta = Object.assign(this.meta, loadedMeta);
          this._initProjections();
        }
      } catch (err) {
        console.warn('Using default Bailadila DEM metadata:', err);
      }

      // 2. Fetch PNG heightmap
      try {
        const pngRes = await fetch(pngUrl).catch(() => fetch('/bailadila_terrain_256.png'));
        const arrayBuf = await pngRes.arrayBuffer();
        await this._decode16BitPNG(arrayBuf);
      } catch (err) {
        console.warn('Direct 16-bit PNG stream decode failed, trying Canvas fallback:', err);
        await this._decodeWithCanvas(pngUrl);
      }

      // 3. Fetch canonical Deposit-14 simulation route
      try {
        const routeRes = await fetch('/api/simulation_route').catch(() => fetch('/bailadila_simulation_data.json'));
        if (routeRes && routeRes.ok) {
          const rData = await routeRes.json();
          this.canonicalWaypoints = rData.waypoints || rData.SIM_WAYPOINTS || null;
        }
      } catch (err) {
        console.warn('Failed to load canonical simulation route:', err);
      }

      this.isLoaded = true;
      return this.meta;
    }

    /**
     * Exact 16-bit PNG decompression using Web Streams API DecompressionStream.
     */
    async _decode16BitPNG(arrayBuf) {
      const dataView = new DataView(arrayBuf);
      let pos = 8;
      const idatParts = [];

      while (pos < arrayBuf.byteLength) {
        const len = dataView.getUint32(pos);
        const c1 = String.fromCharCode(dataView.getUint8(pos + 4));
        const c2 = String.fromCharCode(dataView.getUint8(pos + 5));
        const c3 = String.fromCharCode(dataView.getUint8(pos + 6));
        const c4 = String.fromCharCode(dataView.getUint8(pos + 7));
        const type = c1 + c2 + c3 + c4;

        if (type === 'IDAT') {
          idatParts.push(new Uint8Array(arrayBuf, pos + 8, len));
        }
        pos += 12 + len;
      }

      if (!idatParts.length) throw new Error('No IDAT chunks found in heightmap PNG');

      // Combine IDAT bytes
      const totalLen = idatParts.reduce((acc, p) => acc + p.length, 0);
      const idatBytes = new Uint8Array(totalLen);
      let offset = 0;
      for (const p of idatParts) {
        idatBytes.set(p, offset);
        offset += p.length;
      }

      // Decompress zlib stream using DecompressionStream
      let decompressed;
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(idatBytes);
        writer.close();
        const res = new Response(ds.readable);
        const decompBuf = await res.arrayBuffer();
        decompressed = new Uint8Array(decompBuf);
      } else {
        throw new Error('DecompressionStream unsupported in this environment');
      }

      // Unfilter 16-bit scanlines
      const W = this.meta.width || 256;
      const H = this.meta.height || 256;
      const bpp = 2; // 2 bytes per pixel (16-bit grayscale)
      const stride = 1 + W * bpp; // 513 bytes per scanline

      this.rawElev = new Float32Array(W * H);
      const prevRow = new Uint8Array(W * bpp);
      const curRow = new Uint8Array(W * bpp);

      const minE = this.meta.minElevationMeters;
      const maxE = this.meta.maxElevationMeters;
      const eRange = maxE - minE;

      for (let y = 0; y < H; y++) {
        const filter = decompressed[y * stride];
        const rowStart = y * stride + 1;

        for (let x = 0; x < W * bpp; x++) {
          const raw = decompressed[rowStart + x];
          const a = (x >= bpp) ? curRow[x - bpp] : 0;
          const b = prevRow[x];
          const c = (x >= bpp) ? prevRow[x - bpp] : 0;
          let val = 0;

          if (filter === 0) val = raw;
          else if (filter === 1) val = (raw + a) & 0xff;
          else if (filter === 2) val = (raw + b) & 0xff;
          else if (filter === 3) val = (raw + Math.floor((a + b) / 2)) & 0xff;
          else if (filter === 4) {
            const p = a + b - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            val = (raw + pr) & 0xff;
          }
          curRow[x] = val;
        }
        prevRow.set(curRow);

        for (let x = 0; x < W; x++) {
          const gray16 = (curRow[x * 2] << 8) | curRow[x * 2 + 1];
          const norm = gray16 / 65535.0;
          this.rawElev[y * W + x] = minE + norm * eRange;
        }
      }
    }

    /**
     * Fallback decoder using Canvas2D (standard 8-bit channel extraction)
     */
    _decodeWithCanvas(pngUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const W = img.width || 256;
          const H = img.height || 256;
          const canvas = document.createElement('canvas');
          canvas.width = W;
          canvas.height = H;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, W, H).data;

          this.rawElev = new Float32Array(W * H);
          const minE = this.meta.minElevationMeters;
          const maxE = this.meta.maxElevationMeters;
          const eRange = maxE - minE;

          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const idx = (y * W + x) * 4;
              const g8 = imgData[idx];
              const norm = g8 / 255.0;
              this.rawElev[y * W + x] = minE + norm * eRange;
            }
          }
          resolve();
        };
        img.onerror = reject;
        img.src = pngUrl;
      });
    }

    /**
     * Bilinear sample of raw DEM elevation at (lon, lat).
     */
    sampleRawElevation(lon, lat) {
      if (!this.rawElev) return this.yMin + 200;
      const W = this.meta.width || 256;
      const H = this.meta.height || 256;

      const fx = (lon - this.meta.west) / (this.meta.east - this.meta.west) * (W - 1);
      const fz = (this.meta.north - lat) / (this.meta.north - this.meta.south) * (H - 1);

      const x0 = Math.max(0, Math.min(W - 1, Math.floor(fx)));
      const z0 = Math.max(0, Math.min(H - 1, Math.floor(fz)));
      const x1 = Math.min(W - 1, x0 + 1);
      const z1 = Math.min(H - 1, z0 + 1);

      const tx = fx - x0;
      const tz = fz - z0;

      const a = this.rawElev[z0 * W + x0];
      const b = this.rawElev[z0 * W + x1];
      const c = this.rawElev[z1 * W + x0];
      const d = this.rawElev[z1 * W + x1];

      return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
    }

    sampleRawElevationXZ(x, z) {
      const geo = this.worldToLonLat(x, z);
      return this.sampleRawElevation(geo.lon, geo.lat);
    }

    /**
     * CONCEPTUAL OPEN-PIT CARVED ELEVATION
     * Carved realistically into the Deposit-14 mountain flank with 10 stepped benches.
     */
    sampleCarvedElevationXZ(x, z) {
      const rawDemH = this.sampleRawElevationXZ(x, z);
      if (!this.showPit) return rawDemH;

      const dx = x - this.pitPos.x;
      const dz = z - this.pitPos.z;

      // Elliptical angle & organic boundary perturbation
      const theta = Math.atan2(dz, dx);
      const rOrganic = 1.0 + 0.12 * Math.cos(3 * theta + 0.5) + 0.08 * Math.sin(5 * theta - 0.7) + 0.04 * Math.cos(2 * theta);
      const normDist = Math.hypot(dx / this.pitRX, dz / this.pitRZ) / rOrganic;

      if (normDist >= 1.0) {
        return rawDemH; // Outside pit footprint
      }

      // Base rim elevation at Deposit-14 crest
      const rimH = this.sampleRawElevationXZ(this.pitPos.x, this.pitPos.z) + 12.0;
      const floorH = Math.max(this.yMin + 25.0, rimH - this.pitCutDepth);
      const totalCut = rimH - floorH;

      // 10 stepped conceptual benches
      const numBenches = this.pitBenches;
      const benchHeight = totalCut / numBenches;

      let pitH;
      if (normDist > 0.88) {
        // Sigmoid rim blend connecting natural DEM contour to top bench
        const blend = (normDist - 0.88) / 0.12;
        const topBenchH = rimH - benchHeight * 0.4;
        pitH = topBenchH * (1.0 - blend) + rawDemH * blend;
      } else if (normDist > 0.15) {
        // Stepped benches with flat floors and sloped berm faces
        const benchParam = (0.88 - normDist) / 0.73 * numBenches;
        const benchIndex = Math.min(numBenches - 1, Math.floor(benchParam));
        const benchFrac = benchParam - benchIndex; // 0.0 -> 1.0 within bench interval

        // Flat working bench floor (75%), steep rock face transition (25%)
        let stepOffset;
        if (benchFrac < 0.75) {
          stepOffset = (benchIndex + 0.08) * benchHeight;
        } else {
          const slopeFrac = (benchFrac - 0.75) / 0.25;
          stepOffset = (benchIndex + 0.08 + slopeFrac * 0.92) * benchHeight;
        }
        pitH = rimH - stepOffset;
      } else {
        // Pit bottom loading floor
        pitH = floorH;
      }

      // Pit is CARVED into the mountain, so it never exceeds the natural DEM surface
      return Math.min(rawDemH, pitH);
    }

    sampleCarvedElevation(lon, lat) {
      const pos = this.lonLatToWorld(lon, lat, 0);
      return this.sampleCarvedElevationXZ(pos.x, pos.z);
    }

    /**
     * BUILD REAL 3D TERRAIN MESH
     * 256x256 dense vertex grid with engineering mining palette.
     */
    buildTerrain(scene, vscale = 1.0) {
      this.vscale = vscale;
      if (this.terrainMesh && scene) {
        scene.remove(this.terrainMesh);
        if (this.terrainMesh.geometry) this.terrainMesh.geometry.dispose();
      }

      const W = this.meta.width || 256;
      const H = this.meta.height || 256;
      const geo = new THREE.BufferGeometry();

      const positions = [];
      const colors = [];
      const indices = [];

      // Realistic Mining Color Palette
      const cPeakSlate = new THREE.Color(0x56605a);   // Weathered quartzite / ridge rock
      const cRidgeIron  = new THREE.Color(0x6b3f30);   // Natural ironstone ridge
      const cMidScrub   = new THREE.Color(0x5e5647);   // Bastar ferruginous forest scrub
      const cLowPlain   = new THREE.Color(0x3d382f);   // Lower valley alluvial floor
      const cHematite   = new THREE.Color(0x7A2E1D);   // High-grade dark red hematite ore
      const cIronbloom  = new THREE.Color(0xC2673B);   // Oxidized ironbloom / bench terrace
      const cBenchFloor = new THREE.Color(0x8C5632);   // Active bench working floor
      const cPitFloor   = new THREE.Color(0x50331C);   // Deep loading bay pit floor

      const minE = this.meta.minElevationMeters;
      const maxE = this.meta.maxElevationMeters;
      const eSpan = maxE - minE;

      for (let j = 0; j < H; j++) {
        const lat = this.meta.north - (j / (H - 1)) * (this.meta.north - this.meta.south);
        for (let i = 0; i < W; i++) {
          const lon = this.meta.west + (i / (W - 1)) * (this.meta.east - this.meta.west);
          const rawH = this.sampleRawElevation(lon, lat);
          const finalH = this.sampleCarvedElevation(lon, lat);
          const worldPos = this.lonLatToWorld(lon, lat, finalH, vscale);

          positions.push(worldPos.x, worldPos.y, worldPos.z);

          // Pit influence calculation
          const dx = worldPos.x - this.pitPos.x;
          const dz = worldPos.z - this.pitPos.z;
          const theta = Math.atan2(dz, dx);
          const rOrg = 1.0 + 0.12 * Math.cos(3 * theta + 0.5) + 0.08 * Math.sin(5 * theta - 0.7);
          const uDist = Math.hypot(dx / this.pitRX, dz / this.pitRZ) / rOrg;

          const isInsidePit = (uDist < 0.96) && (this.showPit);
          const elevNorm = Math.max(0, Math.min(1, (finalH - minE) / eSpan));

          const col = new THREE.Color();
          if (isInsidePit) {
            // Stepped bench & ore coloration
            if (uDist < 0.16) {
              col.copy(cPitFloor);
            } else {
              const benchVal = (0.88 - uDist) / 0.72 * this.pitBenches;
              const frac = benchVal - Math.floor(benchVal);
              if (frac < 0.72) {
                col.copy(cBenchFloor).lerp(cIronbloom, Math.sin(benchVal * 3.14) * 0.25);
              } else {
                col.copy(cHematite); // Exposed rock face
              }
            }
            // Add subtle ore grain
            const speck = (Math.sin(worldPos.x * 0.05 + worldPos.z * 0.05) * 0.5) * 0.05;
            col.offsetHSL(0, 0, speck);
          } else {
            // Authentic Regional DEM Topography Palette
            if (elevNorm < 0.30) {
              col.copy(cLowPlain).lerp(cMidScrub, elevNorm / 0.30);
            } else if (elevNorm < 0.70) {
              const q = (elevNorm - 0.30) / 0.40;
              col.copy(cMidScrub).lerp(cRidgeIron, q);
            } else {
              const q = (elevNorm - 0.70) / 0.30;
              col.copy(cRidgeIron).lerp(cPeakSlate, q);
            }
            // Gentle rock variation
            const grain = (Math.sin(worldPos.x * 0.02) * Math.cos(worldPos.z * 0.02)) * 0.035;
            col.offsetHSL(0, 0, grain);
          }

          colors.push(col.r, col.g, col.b);
        }
      }

      // Triangulate grid
      for (let j = 0; j < H - 1; j++) {
        for (let i = 0; i < W - 1; i++) {
          const a = j * W + i;
          const b = a + 1;
          const c = a + W;
          const d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }

      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.94,
        metalness: 0.04,
        flatShading: false
      });

      this.terrainMesh = new THREE.Mesh(geo, mat);
      this.terrainMesh.name = 'BailadilaDEMTerrain';
      if (scene) scene.add(this.terrainMesh);

      return this.terrainMesh;
    }

    /**
     * BUILD TERRAIN-FOLLOWING HAUL ROAD SYSTEM
     * Conforms directly to the carved terrain surface (no floating tubes).
     */
    /**
     * BUILD TERRAIN-CONFORMING BLACK MINE HAUL ROAD
     * Physical, high-contrast, dark charcoal / black mine haul road surface
     * that follows the exact 16 canonical Deposit-14 waypoints used by the simulation.
     * Drapes tightly over the carved open-cast terrain benches with per-vertex elevation sampling.
     */
    buildHaulRoads(scene, vscale = 1.0, waypoints = null) {
      if (this.roadGroup && scene) {
        scene.remove(this.roadGroup);
      }
      this.roadGroup = new THREE.Group();
      this.roadGroup.name = 'BailadilaHaulRoads';

      const wpList = waypoints || this.canonicalWaypoints || CANONICAL_DEPOSIT_14_WAYPOINTS;
      const worldWaypoints = wpList.map(wp => {
        const pos = this.lonLatToWorld(wp.lng, wp.lat, 0);
        return new THREE.Vector3(pos.x, 0, pos.z);
      });
      const numWp = worldWaypoints.length;

      // 1. Generate dense stations along the exact waypoint segments (~5m spacing)
      // This guarantees ROAD PATH == VEHICLE ROUTE with zero deviation.
      const stations = [];
      for (let i = 0; i < numWp; i++) {
        const p1 = worldWaypoints[i];
        const p2 = worldWaypoints[(i + 1) % numWp];
        const segDist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
        const nSteps = Math.max(8, Math.round(segDist / 5.0));
        for (let s = 0; s < nSteps; s++) {
          const t = s / nSteps;
          const sx = p1.x + (p2.x - p1.x) * t;
          const sz = p1.z + (p2.z - p1.z) * t;
          const h = this.sampleCarvedElevationXZ(sx, sz);
          const sy = (h - this.yMin) * vscale;
          stations.push(new THREE.Vector3(sx, sy, sz));
        }
      }
      this.sampledRoad = stations;
      const numStations = stations.length;

      // 2. Compute smooth tangents and normals along the route stations
      this.sampledNormals = [];
      this.sampledTangents = [];
      for (let i = 0; i < numStations; i++) {
        const pPrev = stations[(i - 1 + numStations) % numStations];
        const pNext = stations[(i + 1) % numStations];
        const tang = new THREE.Vector3().subVectors(pNext, pPrev);
        tang.y = 0;
        tang.normalize();
        this.sampledTangents.push(tang);
        const norm = new THREE.Vector3(-tang.z, 0, tang.x).normalize();
        this.sampledNormals.push(norm);
      }

      // 3. Construct 5-column conforming black haul road mesh
      // Width: 28m total (14m left, 14m right) — slightly wider than the 22m truck (~2.5x vehicle width)
      const basePositions = [];
      const baseColors = [];
      const baseIndices = [];

      // Dark charcoal / black palette (contrasting with lighter mine terrain):
      // Outer edges: dusty dark charcoal (#242220)
      // Mid lanes: deep tire-compacted black (#161618)
      // Center: matte black haul asphalt (#121214)
      const cEdge = new THREE.Color(0.14, 0.13, 0.12);
      const cMid = new THREE.Color(0.08, 0.08, 0.09);
      const cCenter = new THREE.Color(0.06, 0.06, 0.07);

      const halfW = 14.0;
      const offsets = [-halfW, -halfW * 0.5, 0.0, halfW * 0.5, halfW];
      const crowns = [0.00, 0.04, 0.06, 0.04, 0.00];
      const colColors = [cEdge, cMid, cCenter, cMid, cEdge];

      for (let i = 0; i < numStations; i++) {
        const p = stations[i];
        const norm = this.sampledNormals[i];

        for (let c = 0; c < 5; c++) {
          const vx = p.x + norm.x * offsets[c];
          const vz = p.z + norm.z * offsets[c];
          // Sample exact carved terrain elevation at each individual vertex
          const elev = (this.sampleCarvedElevationXZ(vx, vz) - this.yMin) * vscale;
          const vy = elev + 0.35 + crowns[c]; // 0.35m above terrain to prevent z-fighting

          basePositions.push(vx, vy, vz);
          baseColors.push(colColors[c].r, colColors[c].g, colColors[c].b);
        }

        if (i > 0) {
          const curBase = i * 5;
          const prevBase = (i - 1) * 5;
          for (let q = 0; q < 4; q++) {
            const pA = prevBase + q;
            const pB = prevBase + q + 1;
            const cA = curBase + q;
            const cB = curBase + q + 1;
            baseIndices.push(pA, cA, pB, pB, cA, cB);
          }
        }
      }

      // Connect seamless closed loop
      if (numStations > 2) {
        const curBase = 0;
        const prevBase = (numStations - 1) * 5;
        for (let q = 0; q < 4; q++) {
          const pA = prevBase + q;
          const pB = prevBase + q + 1;
          const cA = curBase + q;
          const cB = curBase + q + 1;
          baseIndices.push(pA, cA, pB, pB, cA, cB);
        }
      }

      const roadGeo = new THREE.BufferGeometry();
      roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(basePositions, 3));
      roadGeo.setAttribute('color', new THREE.Float32BufferAttribute(baseColors, 3));
      roadGeo.setIndex(baseIndices);
      roadGeo.computeVertexNormals();

      const roadMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.94,
        metalness: 0.06,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2.0,
        polygonOffsetUnits: -4.0
      });
      this.roadBaseMesh = new THREE.Mesh(roadGeo, roadMat);
      this.roadBaseMesh.name = 'HaulRoadBase';
      this.roadBaseMesh.receiveShadow = true;
      this.roadGroup.add(this.roadBaseMesh);

      // Industrial rock safety berm boulders along switchbacks (muted dark boulders)
      const bermMat = new THREE.MeshStandardMaterial({ color: 0x383028, roughness: 0.96 });
      const bermGeo = new THREE.BoxGeometry(2.6, 2.0, 4.2);
      for (let s = 4; s < numStations; s += 10) {
        const p = stations[s];
        const norm = this.sampledNormals[s];
        const bx = p.x + norm.x * (halfW + 1.2);
        const bz = p.z + norm.z * (halfW + 1.2);
        const by = (this.sampleCarvedElevationXZ(bx, bz) - this.yMin) * vscale + 1.0;
        const berm = new THREE.Mesh(bermGeo, bermMat);
        berm.position.set(bx, by, bz);
        const tang = this.sampledTangents[s];
        berm.rotation.y = Math.atan2(tang.x, tang.z);
        this.roadGroup.add(berm);
      }

      if (scene) scene.add(this.roadGroup);
      return this.roadGroup;
    }

    /**
     * SELECT ACTIVE VEHICLE
     */
    setSelectedVehicle(vId) {
      if (!vId) return;
      let matchedKey = vId;
      if (!this.truckObjects[matchedKey]) {
        for (const k in this.truckObjects) {
          if (this.truckObjects[k].idText === vId || (this.truckObjects[k].mesh && this.truckObjects[k].mesh.name === vId)) {
            matchedKey = k;
            break;
          }
        }
      }
      this.selectedVehicleId = matchedKey;
    }

    recordVehicleTrail(vId, currentPos) {
      // Clean physical road representation
    }

    updateActiveRouteHighlight() {
      // Clean physical road representation
    }

    updateHazardRoadSegment(fleet) {
      // Clean physical road representation
    }

    updateVehicleTrailsVisual() {
      // Clean physical road representation
    }

    /**
     * Compute point and tangent along the haul road.
     */
    getRoadPointAndTangent(t) {
      if (!this.sampledRoad || !this.sampledRoad.length) {
        return { point: new THREE.Vector3(), tangent: new THREE.Vector3(0, 0, 1) };
      }
      const safeT = Math.min(0.9999, Math.max(0.0001, t));
      const idxFloat = safeT * (this.sampledRoad.length - 1);
      const i0 = Math.floor(idxFloat);
      const i1 = Math.min(i0 + 1, this.sampledRoad.length - 1);
      const frac = idxFloat - i0;

      const pt = new THREE.Vector3().lerpVectors(this.sampledRoad[i0], this.sampledRoad[i1], frac);
      const tang = new THREE.Vector3().subVectors(this.sampledRoad[i1], this.sampledRoad[i0]).normalize();
      return { point: pt, tangent: tang };
    }

    /**
     * PROCEDURAL HEAVY MINING HAUL TRUCK
     * Visually prominent CAT/NMDC mining dump truck with 6 wheels, cabin, bed, grille & ID tag.
     */
    createMiningTruck(truckId, colorHex = 0xe5a93c) {
      const truck = new THREE.Group();
      truck.name = truckId;

      // Dimensions (realistic proportioned mining dump truck)
      const L = 42.0, W = 22.0, H = 19.0;

      // 1. Chassis Frame
      const chassisGeo = new THREE.BoxGeometry(W * 0.9, 5.0, L * 0.85);
      const chassisMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.75 });
      const chassis = new THREE.Mesh(chassisGeo, chassisMat);
      chassis.position.y = 7.0;
      truck.add(chassis);

      // 2. Six Massive Mining Wheels (Front 2 steer, Rear 4 dual)
      const wheelGeo = new THREE.CylinderGeometry(5.2, 5.2, 3.8, 16);
      wheelGeo.rotateZ(Math.PI / 2);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.92 });

      const wheelOffsets = [
        // Front Axle
        [-W * 0.48, 5.2, L * 0.28],
        [ W * 0.48, 5.2, L * 0.28],
        // Rear Dual Axle (Inner & Outer)
        [-W * 0.52, 5.2, -L * 0.24],
        [-W * 0.36, 5.2, -L * 0.24],
        [ W * 0.36, 5.2, -L * 0.24],
        [ W * 0.52, 5.2, -L * 0.24]
      ];
      wheelOffsets.forEach(pos => {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(...pos);
        truck.add(w);
      });

      // 3. Operators Cabin (Front-Left)
      const cabGeo = new THREE.BoxGeometry(W * 0.40, 8.5, L * 0.26);
      const cabMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45 });
      const cab = new THREE.Mesh(cabGeo, cabMat);
      cab.position.set(-W * 0.22, 14.5, L * 0.22);
      truck.add(cab);

      // Windshield
      const winGeo = new THREE.BoxGeometry(W * 0.36, 4.0, 1.2);
      const winMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.1, metalness: 0.8 });
      const win = new THREE.Mesh(winGeo, winMat);
      win.position.set(-W * 0.22, 15.2, L * 0.35 + 0.6);
      truck.add(win);

      // Overhead Rock Shield Canopy
      const canopyGeo = new THREE.BoxGeometry(W * 0.95, 1.4, L * 0.35);
      const canopyMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.6 });
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.position.set(0, 19.5, L * 0.24);
      truck.add(canopy);

      // 4. Large Dump Bed (Sloped rear profile)
      const bedGeo = new THREE.BoxGeometry(W * 0.94, 9.5, L * 0.55);
      const bedMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.55 });
      const bed = new THREE.Mesh(bedGeo, bedMat);
      bed.position.set(0, 14.8, -L * 0.14);
      bed.rotation.x = -0.06;
      truck.add(bed);

      // 5. Front Radiator Grille & Spotlights
      const grilleGeo = new THREE.BoxGeometry(W * 0.55, 6.0, 1.0);
      const grilleMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });
      const grille = new THREE.Mesh(grilleGeo, grilleMat);
      grille.position.set(W * 0.16, 10.0, L * 0.42);
      truck.add(grille);

      // Headlights
      const hlGeo = new THREE.BoxGeometry(2.0, 1.5, 0.8);
      const hlMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
      const hl1 = new THREE.Mesh(hlGeo, hlMat);
      hl1.position.set(-W * 0.38, 9.2, L * 0.42);
      truck.add(hl1);
      const hl2 = new THREE.Mesh(hlGeo, hlMat);
      hl2.position.set( W * 0.38, 9.2, L * 0.42);
      truck.add(hl2);

      // Forward Spotlights (affecting scene)
      const spot = new THREE.SpotLight(0xfffbeb, 1.4, 180, Math.PI / 6, 0.4);
      spot.position.set(0, 12, L * 0.45);
      spot.target.position.set(0, 0, L * 0.45 + 120);
      truck.add(spot);
      truck.add(spot.target);

      // 6. Fog-Guard Radar Safety Ring
      const ringGeo = new THREE.RingGeometry(24, 28, 28);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 1.0;
      truck.add(ring);
      truck.radarRing = ring;

      // 7. Visible Illuminated Vehicle ID Tag Sprite
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.fillRect(0, 0, 256, 80);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 250, 74);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px "Space Grotesk", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(truckId, 128, 42);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(0, 26, 0);
      sprite.scale.set(38, 12, 1);
      truck.add(sprite);

      return truck;
    }

    /**
     * BUILD SIMULATED FLEET OF 6 LARGE DUMP TRUCKS
     */
    buildFleet(scene, fleetList = []) {
      if (this.truckGroup && scene) {
        scene.remove(this.truckGroup);
      }
      this.truckGroup = new THREE.Group();
      this.truckGroup.name = 'BailadilaSimulatedFleet';

      const defaultIds = ['DMP-101', 'DMP-102', 'DMP-103', 'DMP-104', 'DMP-105', 'DMP-106'];
      this.truckObjects = {};

      defaultIds.forEach((id, idx) => {
        const vId = (fleetList && fleetList[idx] && fleetList[idx].id) ? fleetList[idx].id : `TRUCK_0${idx+1}`;
        const truckMesh = this.createMiningTruck(id, 0xe5a93c);
        truckMesh.name = vId;
        this.truckObjects[vId] = {
          mesh: truckMesh,
          idText: id,
          idx,
          targetPos: new THREE.Vector3(),
          targetYaw: 0,
          initialized: false,
          backendData: null
        };
        this.truckGroup.add(truckMesh);
      });

      if (scene) scene.add(this.truckGroup);
      return this.truckGroup;
    }

    /**
     * UPDATE TRUCK LOCATIONS DIRECTLY FROM AUTHORITATIVE BACKEND TELEMETRY
     * No independent clock, no performance.now(), no synthetic tProg progress math.
     * Positions strictly follow (v.lat, v.lng, v.elevation_m, v.heading).
     */
    updateFleetTelemetry(fleet) {
      if (!fleet || !Array.isArray(fleet)) return;

      fleet.forEach(v => {
        const item = this.truckObjects[v.id];
        if (!item || !item.mesh) return;

        item.backendData = v;

        // Authoritative positioning from backend
        const elev = (v.elevation_m !== undefined && v.elevation_m !== null)
          ? v.elevation_m
          : this.sampleCarvedElevation(v.lng, v.lat);
        const targetWorld = this.lonLatToWorld(v.lng, v.lat, elev, this.vscale);
        targetWorld.y += 0.5; // Slight offset so tires sit on terrain surface

        // Authoritative yaw rotation:
        // Heading is in degrees clockwise from North (0° = North, 90° = East, 180° = South, 270° = West).
        // Model faces +Z (South) at rotation.y = 0.
        // Therefore rotation.y = Math.PI - (heading * Math.PI / 180.0).
        const headingDeg = (v.heading !== undefined && v.heading !== null) ? v.heading : 0;
        const targetYaw = Math.PI - (headingDeg * Math.PI / 180.0);

        if (!item.initialized) {
          item.mesh.position.set(targetWorld.x, targetWorld.y, targetWorld.z);
          item.mesh.rotation.y = targetYaw;
          item.targetPos.set(targetWorld.x, targetWorld.y, targetWorld.z);
          item.targetYaw = targetYaw;
          item.initialized = true;
        } else {
          item.targetPos.set(targetWorld.x, targetWorld.y, targetWorld.z);
          item.targetYaw = targetYaw;
        }

        // Radar safety ring color based on authoritative risk / action
        if (item.mesh.radarRing) {
          const riskTotal = (v.risk_score && v.risk_score.total !== undefined) ? v.risk_score.total : 0;
          if (v.action === 'STOP' || riskTotal >= 70 || (v.dist_front !== undefined && v.dist_front < 60)) {
            item.mesh.radarRing.material.color.setHex(0xef4444); // Red collision hazard
            item.mesh.radarRing.material.opacity = 0.85;
          } else if (v.action === 'SLOW DOWN' || riskTotal >= 40 || (v.dist_front !== undefined && v.dist_front < 150)) {
            item.mesh.radarRing.material.color.setHex(0xf59e0b); // Amber caution
            item.mesh.radarRing.material.opacity = 0.65;
          } else {
            item.mesh.radarRing.material.color.setHex(0x10b981); // Green clear
            item.mesh.radarRing.material.opacity = 0.45;
          }
        }
        // Record historical travelled trail point
        this.recordVehicleTrail(v.id, item.mesh.position);
      });
    }

    /**
     * FRAME INTERPOLATION (SMOOTHING A -> B BETWEEN 1-SECOND SERVER TICKS)
     * Strictly client-side smoothing towards backend target without altering progression.
     */
    stepInterpolation(dt = 0.016) {
      const alpha = Math.min(1.0, dt * 5.0);
      for (const vId in this.truckObjects) {
        const item = this.truckObjects[vId];
        if (!item || !item.mesh || !item.initialized) continue;

        // Smoothly interpolate horizontal position (X, Z) towards backend target
        item.mesh.position.x += (item.targetPos.x - item.mesh.position.x) * alpha;
        item.mesh.position.z += (item.targetPos.z - item.mesh.position.z) * alpha;

        // CRITICAL: Calculate current visual elevation from the road/terrain at its CURRENT visual (x, z) position!
        // This ensures the truck NEVER sinks into cliffs, benches, or underground during movement.
        const curSurfaceH = this.sampleCarvedElevationXZ(item.mesh.position.x, item.mesh.position.z);
        item.mesh.position.y = (curSurfaceH - this.yMin) * this.vscale + 0.50;

        // Shortest arc yaw rotation lerp
        let dyaw = item.targetYaw - item.mesh.rotation.y;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        item.mesh.rotation.y += dyaw * alpha;

        // Follow road slopes (pitch along travel direction)
        const fwdX = -Math.sin(item.mesh.rotation.y);
        const fwdZ = -Math.cos(item.mesh.rotation.y);
        const probeDist = 5.0;
        const hFront = this.sampleCarvedElevationXZ(item.mesh.position.x + fwdX * probeDist, item.mesh.position.z + fwdZ * probeDist);
        const hRear  = this.sampleCarvedElevationXZ(item.mesh.position.x - fwdX * probeDist, item.mesh.position.z - fwdZ * probeDist);
        const targetPitch = Math.atan2((hFront - hRear) * this.vscale, probeDist * 2.0);
        const clampedPitch = Math.max(-0.25, Math.min(0.25, targetPitch));
        item.mesh.rotation.x += (clampedPitch - item.mesh.rotation.x) * alpha;
      }
    }

    /**
     * Real-time geographic state retrieval for Map <-> 3D Synchronization Validation
     */
    getVehicleGeographicState(vId) {
      let item = this.truckObjects[vId];
      if (!item) {
        for (const k in this.truckObjects) {
          if (this.truckObjects[k].idText === vId || (this.truckObjects[k].mesh && this.truckObjects[k].mesh.name === vId)) {
            item = this.truckObjects[k];
            break;
          }
        }
      }
      if (!item || !item.mesh) return null;
      const geo = this.worldToLonLat(item.mesh.position.x, item.mesh.position.z);
      const elev = ((item.mesh.position.y - 0.5) / this.vscale) + this.yMin;
      const surfaceElev = this.sampleCarvedElevation(geo.lon, geo.lat);
      let headingDeg = (Math.PI - item.mesh.rotation.y) * 180.0 / Math.PI;
      headingDeg = (headingDeg % 360 + 360) % 360;
      return {
        id: vId,
        lat: geo.lat,
        lng: geo.lon,
        elevation_m: elev,
        surface_elevation_m: surfaceElev,
        heading: headingDeg,
        backend: item.backendData || null
      };
    }

    /**
     * Focus 3D camera / orbit controls on a vehicle
     */
    focusVehicle(vId, controls) {
      const item = this.truckObjects[vId];
      if (!item || !item.mesh) return;
      const p = item.mesh.position;
      if (controls && controls.target) {
        controls.target.set(p.x, p.y + 10, p.z);
        controls.update();
      }
    }

    /**
     * Set up raycasting click selection for trucks in 3D scene
     */
    setupInteraction(camera, domElement, onSelectVehicle) {
      if (!camera || !domElement) return;
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      domElement.addEventListener('click', (event) => {
        const rect = domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        if (!this.truckGroup) return;

        const intersects = raycaster.intersectObjects(this.truckGroup.children, true);
        if (intersects.length > 0) {
          let obj = intersects[0].object;
          while (obj && obj.parent && obj.parent !== this.truckGroup) {
            obj = obj.parent;
          }
          if (obj) {
            for (const [vId, entry] of Object.entries(this.truckObjects)) {
              if (entry.mesh === obj || entry.idText === obj.name || vId === obj.name) {
                if (typeof onSelectVehicle === 'function') {
                  onSelectVehicle(vId);
                }
                break;
              }
            }
          }
        }
      });
    }

    /**
     * BUILD TERRAIN-AWARE HAZARD ZONES & FOG INVERSION DISC
     */
    buildHazardZones(scene, vscale = 1.0) {
      if (this.hazardGroup && scene) {
        scene.remove(this.hazardGroup);
      }
      this.hazardGroup = new THREE.Group();
      this.hazardGroup.name = 'BailadilaHazardZones';

      const pC = this.pitPos;
      const floorH = Math.max(this.yMin + 25.0, this.sampleRawElevationXZ(pC.x, pC.z) - this.pitCutDepth);
      const floorY = (floorH - this.yMin) * vscale;

      // 1. Pit Bottom Fog Inversion Translucent Disc
      const fogDiscGeo = new THREE.CylinderGeometry(this.pitRX * 0.45, this.pitRX * 0.55, 25, 32);
      const fogDiscMat = new THREE.MeshBasicMaterial({
        color: 0x93c5fd,
        transparent: true,
        opacity: 0.18,
        depthWrite: false
      });
      const fogDisc = new THREE.Mesh(fogDiscGeo, fogDiscMat);
      fogDisc.position.set(pC.x, floorY + 14, pC.z);
      this.hazardGroup.add(fogDisc);

      // 2. High-Wall Steep Slope Drop-Off Hazard Overlays
      const dropOffMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.35,
        wireframe: true
      });
      const highWallArcs = [
        { angle: -0.4, r: this.pitRX * 0.78, h: floorY + 110 },
        { angle:  1.2, r: this.pitRX * 0.82, h: floorY + 140 },
        { angle:  2.6, r: this.pitRX * 0.74, h: floorY + 80 }
      ];
      highWallArcs.forEach(hw => {
        const arcGeo = new THREE.TorusGeometry(hw.r, 8, 4, 24, Math.PI / 3);
        arcGeo.rotateX(Math.PI / 2);
        arcGeo.rotateY(hw.angle);
        const arc = new THREE.Mesh(arcGeo, dropOffMat);
        arc.position.set(pC.x, hw.h, pC.z);
        this.hazardGroup.add(arc);
      });

      // 3. Switchback Hairpin Caution Rings
      const hairpinMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.45,
        wireframe: true
      });
      const hairpins = [
        new THREE.Vector3(pC.x + 820, floorY + 160, pC.z - 180),
        new THREE.Vector3(pC.x - 260, floorY + 90,  pC.z + 580),
        new THREE.Vector3(pC.x - 680, floorY + 40,  pC.z - 60)
      ];
      hairpins.forEach(hp => {
        const hpGeo = new THREE.RingGeometry(25, 32, 16);
        hpGeo.rotateX(-Math.PI / 2);
        const hpMesh = new THREE.Mesh(hpGeo, hairpinMat);
        hpMesh.position.set(hp.x, hp.y, hp.z);
        this.hazardGroup.add(hpMesh);
      });

      if (scene) scene.add(this.hazardGroup);
      return this.hazardGroup;
    }

    /**
     * BUILD GEODETIC LANDMARK PINS & LABELS
     */
    buildLandmarks(scene, vscale = 1.0) {
      if (this.landmarkGroup && scene) {
        scene.remove(this.landmarkGroup);
      }
      this.landmarkGroup = new THREE.Group();
      this.landmarkGroup.name = 'BailadilaLandmarks';

      Object.values(LANDMARKS).forEach(lm => {
        const h = (lm.type === 'pit') ? this.sampleCarvedElevation(lm.lon, lm.lat) : this.sampleRawElevation(lm.lon, lm.lat);
        const pos = this.lonLatToWorld(lm.lon, lm.lat, h, vscale);

        // Pin cone
        const pinColor = (lm.type === 'pit') ? 0xef4444 : (lm.type === 'complex' ? 0x38bdf8 : 0xf59e0b);
        const pinGeo = new THREE.ConeGeometry(18, 55, 12);
        const pinMat = new THREE.MeshStandardMaterial({
          color: pinColor,
          roughness: 0.3,
          emissive: pinColor,
          emissiveIntensity: 0.35
        });
        const pin = new THREE.Mesh(pinGeo, pinMat);
        pin.position.set(pos.x, pos.y + 35, pos.z);
        this.landmarkGroup.add(pin);

        // Label sprite
        const canvas = document.createElement('canvas');
        canvas.width = 380;
        canvas.height = 70;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(7, 14, 18, 0.88)';
        ctx.fillRect(0, 0, 380, 70);
        ctx.strokeStyle = (lm.type === 'pit') ? '#ef4444' : '#38bdf8';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, 376, 66);
        ctx.fillStyle = '#EDE6D6';
        ctx.font = 'bold 24px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lm.name, 190, 36);

        const tex = new THREE.CanvasTexture(canvas);
        const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(sm);
        sprite.position.set(pos.x, pos.y + 95, pos.z);
        sprite.scale.set(160, 32, 1);
        this.landmarkGroup.add(sprite);
      });

      if (scene) scene.add(this.landmarkGroup);
      return this.landmarkGroup;
    }

    /**
     * VISIBILITY TOGGLE HANDLERS
     */
    setTerrainVisible(visible) {
      this.showTerrain = !!visible;
      if (this.terrainMesh) this.terrainMesh.visible = this.showTerrain;
    }

    setMineVisible(scene, visible) {
      this.showPit = !!visible;
      // Rebuild terrain and roads with pit carved or uncarved
      this.buildTerrain(scene, this.vscale);
      this.buildHaulRoads(scene, this.vscale);
    }

    setRoadsVisible(visible) {
      this.showRoads = !!visible;
      if (this.roadGroup) this.roadGroup.visible = this.showRoads;
    }

    setTrucksVisible(visible) {
      this.showTrucks = !!visible;
      if (this.truckGroup) this.truckGroup.visible = this.showTrucks;
    }

    setHazardsVisible(visible) {
      this.showHazards = !!visible;
      if (this.hazardGroup) this.hazardGroup.visible = this.showHazards;
    }

    setVerticalScale(scene, vscale) {
      this.vscale = vscale;
      this.buildTerrain(scene, vscale);
      this.buildHaulRoads(scene, vscale);
      this.buildHazardZones(scene, vscale);
      this.buildLandmarks(scene, vscale);
    }

    /**
     * Optimal camera starting position framing Deposit 14 pit and surrounding Bailadila mountain range.
     */
    getRecommendedCameraOverview() {
      const pC = this.pitPos;
      return {
        position: new THREE.Vector3(pC.x + 1550, 1100, pC.z + 1850),
        target: new THREE.Vector3(pC.x + 80, 410, pC.z + 80)
      };
    }
  }

  // Export to global scope
  global.BailadilaTerrainEngine = BailadilaTerrainEngine;
  global.bailadilaEngine = new BailadilaTerrainEngine();

})(typeof window !== 'undefined' ? window : this);
