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
     * BUILD TERRAIN-CONFORMING MINING HAUL ROAD SYSTEM & MULTI-LAYER ROUTE INFRASTRUCTURE
     * Conforms directly to the carved open-cast mine terrain with multi-vertex cross-sections,
     * realistic gravel/ironstone shoulders, dashed amber centerline, direction chevrons,
     * dynamic active vehicle route highlight, and travelled trail visualization.
     */
    buildHaulRoads(scene, vscale = 1.0, waypoints = null) {
      if (this.roadGroup && scene) {
        scene.remove(this.roadGroup);
      }
      this.roadGroup = new THREE.Group();
      this.roadGroup.name = 'BailadilaHaulRoads';

      const wpList = waypoints || this.canonicalWaypoints || CANONICAL_DEPOSIT_14_WAYPOINTS;
      const rawWaypoints = wpList.map(wp => {
        const pos = this.lonLatToWorld(wp.lng, wp.lat, 0);
        return new THREE.Vector3(pos.x, 0, pos.z);
      });

      // Assign terrain elevation to control waypoints
      rawWaypoints.forEach(pt => {
        const h = this.sampleCarvedElevationXZ(pt.x, pt.z);
        pt.y = (h - this.yMin) * vscale + 0.75;
      });

      const isLoop = true;
      this.roadCurve = new THREE.CatmullRomCurve3(rawWaypoints, isLoop, 'catmullrom', 0.28);

      const ROAD_SAMPLES = 420;
      this.sampledRoad = this.roadCurve.getPoints(ROAD_SAMPLES);
      this.sampledNormals = [];
      this.sampledTangents = [];
      this.sampledWidths = [];

      const numStations = this.sampledRoad.length;

      // 1. Calculate tangent, normal, curvature, and variable width for each station
      for (let i = 0; i < numStations; i++) {
        const prevIdx = (i > 0) ? i - 1 : (isLoop ? numStations - 2 : 0);
        const nextIdx = (i < numStations - 1) ? i + 1 : (isLoop ? 1 : i);

        const prev = this.sampledRoad[prevIdx];
        const next = this.sampledRoad[nextIdx];
        const curr = this.sampledRoad[i];

        const tang = new THREE.Vector3().subVectors(next, prev);
        tang.y = 0;
        tang.normalize();
        this.sampledTangents.push(tang);

        const norm = new THREE.Vector3(-tang.z, 0, tang.x).normalize();
        this.sampledNormals.push(norm);

        // Curvature factor: measure angle between incoming and outgoing directions
        const inDir = new THREE.Vector3().subVectors(curr, prev).normalize();
        const outDir = new THREE.Vector3().subVectors(next, curr).normalize();
        const dot = Math.max(-1, Math.min(1, inDir.dot(outDir)));
        const curveFactor = 1.0 - dot;

        // Base width: 36m on straightaways, widened up to 48m around sharp switchbacks
        const w = 36.0 + Math.min(12.0, curveFactor * 30.0);
        this.sampledWidths.push(w);

        // Ensure center point is exactly resting on carved terrain surface
        const exactCenterH = this.sampleCarvedElevationXZ(curr.x, curr.z);
        curr.y = (exactCenterH - this.yMin) * vscale + 0.75;
      }

      // =========================================================================
      // A. BASE HAUL ROAD MESH (Conforming 6-Vertex Cross-Section with Berm Edges)
      // =========================================================================
      const basePositions = [];
      const baseColors = [];
      const baseIndices = [];

      // Muted industrial mine road palette:
      // Shoulders: Natural ironstone gravel / overburden (#4a3e33)
      // Road edges: Dark compacted verge (#362f27)
      // Drive lanes: Tire-compacted dark iron-ore haul asphalt (#26211d)
      const cShoulder = new THREE.Color(0.29, 0.24, 0.20);
      const cEdge = new THREE.Color(0.21, 0.18, 0.15);
      const cLane = new THREE.Color(0.15, 0.13, 0.11);

      for (let i = 0; i < numStations; i++) {
        const p = this.sampledRoad[i];
        const norm = this.sampledNormals[i];
        const w = this.sampledWidths[i];
        const hw = w * 0.5;
        const sw = 3.8; // shoulder extra width

        // 6 cross-section points:
        const x0 = p.x - norm.x * (hw + sw), z0 = p.z - norm.z * (hw + sw);
        const x1 = p.x - norm.x * hw,        z1 = p.z - norm.z * hw;
        const x2 = p.x - norm.x * (hw * 0.35), z2 = p.z - norm.z * (hw * 0.35);
        const x3 = p.x + norm.x * (hw * 0.35), z3 = p.z + norm.z * (hw * 0.35);
        const x4 = p.x + norm.x * hw,        z4 = p.z + norm.z * hw;
        const x5 = p.x + norm.x * (hw + sw), z5 = p.z + norm.z * (hw + sw);

        // Sample exact carved terrain elevation at each individual vertex
        const y0 = (this.sampleCarvedElevationXZ(x0, z0) - this.yMin) * vscale + 0.35;
        const y1 = (this.sampleCarvedElevationXZ(x1, z1) - this.yMin) * vscale + 0.70;
        const y2 = (this.sampleCarvedElevationXZ(x2, z2) - this.yMin) * vscale + 0.76;
        const y3 = (this.sampleCarvedElevationXZ(x3, z3) - this.yMin) * vscale + 0.76;
        const y4 = (this.sampleCarvedElevationXZ(x4, z4) - this.yMin) * vscale + 0.70;
        const y5 = (this.sampleCarvedElevationXZ(x5, z5) - this.yMin) * vscale + 0.35;

        basePositions.push(
          x0, y0, z0,
          x1, y1, z1,
          x2, y2, z2,
          x3, y3, z3,
          x4, y4, z4,
          x5, y5, z5
        );

        baseColors.push(
          cShoulder.r, cShoulder.g, cShoulder.b,
          cEdge.r, cEdge.g, cEdge.b,
          cLane.r, cLane.g, cLane.b,
          cLane.r, cLane.g, cLane.b,
          cEdge.r, cEdge.g, cEdge.b,
          cShoulder.r, cShoulder.g, cShoulder.b
        );

        if (i > 0) {
          const curBase = i * 6;
          const prevBase = (i - 1) * 6;
          for (let q = 0; q < 5; q++) {
            const pA = prevBase + q;
            const pB = prevBase + q + 1;
            const cA = curBase + q;
            const cB = curBase + q + 1;
            baseIndices.push(pA, cA, pB, pB, cA, cB);
          }
        }
      }

      // Connect loop end to start
      if (isLoop && numStations > 2) {
        const curBase = 0;
        const prevBase = (numStations - 1) * 6;
        for (let q = 0; q < 5; q++) {
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
        roughness: 0.90,
        metalness: 0.08,
        polygonOffset: true,
        polygonOffsetFactor: -1.0,
        polygonOffsetUnits: -2.0
      });
      this.roadBaseMesh = new THREE.Mesh(roadGeo, roadMat);
      this.roadBaseMesh.name = 'HaulRoadBase';
      this.roadBaseMesh.receiveShadow = true;
      this.roadGroup.add(this.roadBaseMesh);

      // =========================================================================
      // B. SAFETY BERM ROCK POSTS ALONG SWITCHBACKS
      // =========================================================================
      const bermMat = new THREE.MeshStandardMaterial({ color: 0x6e5845, roughness: 0.95 });
      for (let s = 4; s < numStations; s += 8) {
        const p = this.sampledRoad[s];
        const norm = this.sampledNormals[s];
        const hw = this.sampledWidths[s] * 0.5;
        const bx = p.x + norm.x * (hw + 1.8);
        const bz = p.z + norm.z * (hw + 1.8);
        const by = (this.sampleCarvedElevationXZ(bx, bz) - this.yMin) * vscale + 1.4;

        const bermGeo = new THREE.BoxGeometry(3.0, 2.2, 5.0);
        const berm = new THREE.Mesh(bermGeo, bermMat);
        berm.position.set(bx, by, bz);
        const tang = this.sampledTangents[s];
        berm.rotation.y = Math.atan2(tang.x, tang.z);
        this.roadGroup.add(berm);
      }

      // =========================================================================
      // C. ROUTE CENTERLINE (Subtle Amber Dashed Line)
      // =========================================================================
      const clPositions = [];
      const clIndices = [];
      const dashLength = 12.0; // meters
      const gapLength = 7.0;   // meters
      const period = dashLength + gapLength;
      let distAccum = 0;

      for (let i = 0; i < numStations - 1; i++) {
        const p0 = this.sampledRoad[i];
        const p1 = this.sampledRoad[i + 1];
        const segDist = p0.distanceTo(p1);
        const norm = this.sampledNormals[i];
        const halfClW = 0.65; // 1.3m wide dashed line

        // Check if inside dash phase
        const phase = distAccum % period;
        if (phase < dashLength) {
          const y0 = p0.y + 0.08;
          const y1 = p1.y + 0.08;

          const idx = clPositions.length / 3;
          clPositions.push(
            p0.x - norm.x * halfClW, y0, p0.z - norm.z * halfClW,
            p0.x + norm.x * halfClW, y0, p0.z + norm.z * halfClW,
            p1.x - norm.x * halfClW, y1, p1.z - norm.z * halfClW,
            p1.x + norm.x * halfClW, y1, p1.z + norm.z * halfClW
          );
          clIndices.push(idx, idx + 2, idx + 1, idx + 1, idx + 2, idx + 3);
        }
        distAccum += segDist;
      }

      const clGeo = new THREE.BufferGeometry();
      clGeo.setAttribute('position', new THREE.Float32BufferAttribute(clPositions, 3));
      clGeo.setIndex(clIndices);
      clGeo.computeVertexNormals();

      const clMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2.0,
        polygonOffsetUnits: -3.0
      });
      this.roadCenterlineMesh = new THREE.Mesh(clGeo, clMat);
      this.roadCenterlineMesh.name = 'HaulRoadCenterline';
      this.roadGroup.add(this.roadCenterlineMesh);

      // =========================================================================
      // D. DIRECTION CHEVRONS / ARROWS (Traffic Flow Indicators)
      // =========================================================================
      const arrPositions = [];
      const arrIndices = [];
      const arrowStep = 6; // Place chevron every ~65m

      for (let i = 4; i < numStations; i += arrowStep) {
        const p = this.sampledRoad[i];
        const tang = this.sampledTangents[i];
        const norm = this.sampledNormals[i];
        const y = p.y + 0.09;

        // Chevron geometry:
        // Tip forward, two swept-back wings, notched center
        const tipX = p.x + tang.x * 3.5, tipZ = p.z + tang.z * 3.5;
        const lX = p.x - tang.x * 2.2 - norm.x * 2.2, lZ = p.z - tang.z * 2.2 - norm.z * 2.2;
        const notchX = p.x - tang.x * 0.8, notchZ = p.z - tang.z * 0.8;
        const rX = p.x - tang.x * 2.2 + norm.x * 2.2, rZ = p.z - tang.z * 2.2 + norm.z * 2.2;

        const idx = arrPositions.length / 3;
        arrPositions.push(
          tipX, y, tipZ,
          lX, y, lZ,
          notchX, y, notchZ,
          rX, y, rZ
        );
        arrIndices.push(idx, idx + 1, idx + 2, idx, idx + 2, idx + 3);
      }

      const arrGeo = new THREE.BufferGeometry();
      arrGeo.setAttribute('position', new THREE.Float32BufferAttribute(arrPositions, 3));
      arrGeo.setIndex(arrIndices);
      arrGeo.computeVertexNormals();

      const arrMat = new THREE.MeshBasicMaterial({
        color: 0xeab308,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2.0,
        polygonOffsetUnits: -3.0
      });
      this.directionArrowsMesh = new THREE.Mesh(arrGeo, arrMat);
      this.directionArrowsMesh.name = 'HaulRoadDirectionArrows';
      this.roadGroup.add(this.directionArrowsMesh);

      // =========================================================================
      // E. ACTIVE VEHICLE ROUTE FORWARD GUIDE RIBBON
      // =========================================================================
      const actGeo = new THREE.BufferGeometry();
      const ACT_STATIONS = 35;
      const actPos = new Float32Array(ACT_STATIONS * 2 * 3);
      const actIdx = [];
      for (let s = 0; s < ACT_STATIONS - 1; s++) {
        const a = s * 2, b = a + 1, c = (s + 1) * 2, d = c + 1;
        actIdx.push(a, c, b, b, c, d);
      }
      actGeo.setAttribute('position', new THREE.BufferAttribute(actPos, 3));
      actGeo.setIndex(actIdx);

      const actMat = new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3.0,
        polygonOffsetUnits: -4.0
      });
      this.activeRouteMesh = new THREE.Mesh(actGeo, actMat);
      this.activeRouteMesh.name = 'ActiveRouteForwardGuide';
      this.activeRouteMesh.visible = false;
      this.roadGroup.add(this.activeRouteMesh);

      // =========================================================================
      // F. DYNAMIC HAZARD ROAD SEGMENT OVERLAY
      // =========================================================================
      const hazGeo = new THREE.BufferGeometry();
      const HAZ_STATIONS = 16; // ~150m span
      const hazPos = new Float32Array(HAZ_STATIONS * 2 * 3);
      const hazIdx = [];
      for (let s = 0; s < HAZ_STATIONS - 1; s++) {
        const a = s * 2, b = a + 1, c = (s + 1) * 2, d = c + 1;
        hazIdx.push(a, c, b, b, c, d);
      }
      hazGeo.setAttribute('position', new THREE.BufferAttribute(hazPos, 3));
      hazGeo.setIndex(hazIdx);

      this.hazardRoadMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4.0,
        polygonOffsetUnits: -5.0
      });
      this.hazardRoadMesh = new THREE.Mesh(hazGeo, this.hazardRoadMat);
      this.hazardRoadMesh.name = 'HazardRoadSegment';
      this.hazardRoadMesh.visible = false;
      this.roadGroup.add(this.hazardRoadMesh);

      // =========================================================================
      // G. VEHICLE TRAVELLED TRAILS GROUP
      // =========================================================================
      this.trailsGroup = new THREE.Group();
      this.trailsGroup.name = 'BailadilaVehicleTrails';
      this.roadGroup.add(this.trailsGroup);

      if (scene) scene.add(this.roadGroup);
      return this.roadGroup;
    }

    /**
     * SELECT ACTIVE VEHICLE FOR FOCUSED ROUTE HIGHLIGHT & TRAIL VISIBILITY
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
      this.trailsDirty = true;
      this.updateActiveRouteHighlight();
      this.updateVehicleTrailsVisual();
    }

    /**
     * RECORD TRAVELLED VEHICLE PATH FOR HISTORICAL TRAIL
     */
    recordVehicleTrail(vId, currentPos) {
      if (!vId || !currentPos) return;
      if (!this.trailHistory[vId]) {
        this.trailHistory[vId] = [];
      }
      const history = this.trailHistory[vId];
      if (history.length === 0) {
        history.unshift(currentPos.clone());
        this.trailsDirty = true;
      } else {
        const last = history[0];
        const dist = Math.hypot(currentPos.x - last.x, currentPos.z - last.z);
        if (dist > 250) {
          // Large teleport or loop wrap - clear trail
          history.length = 0;
          history.unshift(currentPos.clone());
          this.trailsDirty = true;
        } else if (dist >= 3.0) {
          history.unshift(currentPos.clone());
          if (history.length > 55) {
            history.pop();
          }
          this.trailsDirty = true;
        }
      }
    }

    /**
     * UPDATE ACTIVE VEHICLE FORWARD ROUTE HIGHLIGHT
     */
    updateActiveRouteHighlight() {
      if (!this.activeRouteMesh || !this.sampledRoad || this.sampledRoad.length < 10) return;
      let truck = this.truckObjects[this.selectedVehicleId];
      if (!truck) {
        for (const k in this.truckObjects) {
          if (this.truckObjects[k].idText === this.selectedVehicleId || (this.truckObjects[k].mesh && this.truckObjects[k].mesh.name === this.selectedVehicleId)) {
            truck = this.truckObjects[k];
            break;
          }
        }
      }
      if (!truck || !truck.mesh) {
        this.activeRouteMesh.visible = false;
        return;
      }

      const tPos = truck.mesh.position;
      let closestIdx = 0;
      let closestDist = Infinity;
      const numStations = this.sampledRoad.length;

      for (let i = 0; i < numStations; i++) {
        const d = Math.hypot(this.sampledRoad[i].x - tPos.x, this.sampledRoad[i].z - tPos.z);
        if (d < closestDist) {
          closestDist = d;
          closestIdx = i;
        }
      }

      if (closestDist > 120) {
        this.activeRouteMesh.visible = false;
        return;
      }

      const ACT_STATIONS = 35;
      const posAttr = this.activeRouteMesh.geometry.attributes.position;
      const posArray = posAttr.array;
      const halfW = 7.0;

      for (let s = 0; s < ACT_STATIONS; s++) {
        const stationIdx = (closestIdx + s) % numStations;
        const p = this.sampledRoad[stationIdx];
        const norm = this.sampledNormals[stationIdx];
        const y = p.y + 0.11;

        const base = s * 6;
        posArray[base]     = p.x - norm.x * halfW;
        posArray[base + 1] = y;
        posArray[base + 2] = p.z - norm.z * halfW;

        posArray[base + 3] = p.x + norm.x * halfW;
        posArray[base + 4] = y;
        posArray[base + 5] = p.z + norm.z * halfW;
      }

      posAttr.needsUpdate = true;
      this.activeRouteMesh.visible = true;
    }

    /**
     * UPDATE DYNAMIC HAZARD ROAD SEGMENT
     */
    updateHazardRoadSegment(fleet) {
      if (!this.hazardRoadMesh || !this.sampledRoad || !fleet) return;

      let hazardTruck = null;
      let isCritical = false;

      for (let i = 0; i < fleet.length; i++) {
        const v = fleet[i];
        const riskTotal = (v.risk_score && v.risk_score.total !== undefined) ? v.risk_score.total : 0;
        if (v.action === 'STOP' || riskTotal >= 70 || (v.dist_front !== undefined && v.dist_front < 100)) {
          hazardTruck = v;
          isCritical = true;
          break;
        } else if (v.action === 'SLOW DOWN' || riskTotal >= 40) {
          if (!hazardTruck) {
            hazardTruck = v;
            isCritical = false;
          }
        }
      }

      if (!hazardTruck) {
        this.hazardRoadMesh.visible = false;
        return;
      }

      const item = this.truckObjects[hazardTruck.id];
      const hPos = (item && item.mesh) ? item.mesh.position : this.lonLatToWorld(hazardTruck.lng, hazardTruck.lat, 0);

      let closestIdx = 0;
      let closestDist = Infinity;
      const numStations = this.sampledRoad.length;
      for (let i = 0; i < numStations; i++) {
        const d = Math.hypot(this.sampledRoad[i].x - hPos.x, this.sampledRoad[i].z - hPos.z);
        if (d < closestDist) {
          closestDist = d;
          closestIdx = i;
        }
      }

      const HAZ_STATIONS = 16;
      const startIdx = (closestIdx - 4 + numStations) % numStations;
      const posAttr = this.hazardRoadMesh.geometry.attributes.position;
      const posArray = posAttr.array;

      for (let s = 0; s < HAZ_STATIONS; s++) {
        const stationIdx = (startIdx + s) % numStations;
        const p = this.sampledRoad[stationIdx];
        const norm = this.sampledNormals[stationIdx];
        const w = (this.sampledWidths[stationIdx] || 38.0) * 0.5 + 0.5;
        const y = p.y + 0.13;

        const base = s * 6;
        posArray[base]     = p.x - norm.x * w;
        posArray[base + 1] = y;
        posArray[base + 2] = p.z - norm.z * w;

        posArray[base + 3] = p.x + norm.x * w;
        posArray[base + 4] = y;
        posArray[base + 5] = p.z + norm.z * w;
      }

      posAttr.needsUpdate = true;
      if (isCritical) {
        this.hazardRoadMat.color.setHex(0xef4444); // Critical RED
        this.hazardRoadMat.opacity = 0.70;
      } else {
        this.hazardRoadMat.color.setHex(0xf59e0b); // Warning AMBER
        this.hazardRoadMat.opacity = 0.55;
      }
      this.hazardRoadMesh.visible = true;
    }

    /**
     * UPDATE VISIBLE VEHICLE TRAILS (ACTUAL TRAVELLED PATH)
     */
    updateVehicleTrailsVisual() {
      if (!this.trailsGroup || !this.trailsDirty) return;

      const vIds = Object.keys(this.truckObjects);
      for (let vi = 0; vi < vIds.length; vi++) {
        const vId = vIds[vi];
        const history = this.trailHistory[vId];
        if (!history || history.length < 2) continue;

        let trailMesh = this.trailMeshes[vId];
        const isSelected = (vId === this.selectedVehicleId);
        const trailWidth = isSelected ? 4.5 : 2.0;

        const numPts = history.length;
        const positions = [];
        const colors = [];
        const indices = [];

        // Selected: Restrained cyan (#38bdf8), Non-selected: Muted slate (#94a3b8)
        const baseColor = isSelected ? new THREE.Color(0.22, 0.74, 0.97) : new THREE.Color(0.58, 0.64, 0.72);

        for (let j = 0; j < numPts; j++) {
          const pt = history[j];
          const nextPt = (j < numPts - 1) ? history[j + 1] : history[j];
          const prevPt = (j > 0) ? history[j - 1] : history[j];

          const dir = new THREE.Vector3().subVectors(prevPt, nextPt);
          dir.y = 0;
          if (dir.lengthSq() < 1e-4) {
            dir.set(0, 0, 1);
          } else {
            dir.normalize();
          }
          const norm = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
          const halfW = trailWidth * 0.5;

          const alphaFade = Math.pow(1.0 - (j / numPts), 1.2);
          const y = pt.y + 0.14;

          positions.push(
            pt.x - norm.x * halfW, y, pt.z - norm.z * halfW,
            pt.x + norm.x * halfW, y, pt.z + norm.z * halfW
          );

          const cR = baseColor.r * alphaFade;
          const cG = baseColor.g * alphaFade;
          const cB = baseColor.b * alphaFade;
          colors.push(cR, cG, cB, cR, cG, cB);

          if (j > 0) {
            const cA = j * 2;
            const cB = cA + 1;
            const pA = (j - 1) * 2;
            const pB = pA + 1;
            indices.push(pA, cA, pB, pB, cA, cB);
          }
        }

        if (!trailMesh) {
          const tGeo = new THREE.BufferGeometry();
          tGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          tGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
          tGeo.setIndex(indices);

          const tMat = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: isSelected ? 0.85 : 0.22,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -5.0,
            polygonOffsetUnits: -6.0
          });
          trailMesh = new THREE.Mesh(tGeo, tMat);
          trailMesh.name = `Trail_${vId}`;
          this.trailMeshes[vId] = trailMesh;
          this.trailsGroup.add(trailMesh);
        } else {
          trailMesh.geometry.dispose();
          const tGeo = new THREE.BufferGeometry();
          tGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          tGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
          tGeo.setIndex(indices);
          trailMesh.geometry = tGeo;
          trailMesh.material.opacity = isSelected ? 0.85 : 0.22;
        }
      }

      this.trailsDirty = false;
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

      // Update dynamic road overlays (hazards, active forward guidance, trails)
      this.updateHazardRoadSegment(fleet);
      this.updateActiveRouteHighlight();
      this.updateVehicleTrailsVisual();
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

        // Position Lerp
        item.mesh.position.lerp(item.targetPos, alpha);

        // Shortest arc yaw rotation lerp
        let dyaw = item.targetYaw - item.mesh.rotation.y;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        item.mesh.rotation.y += dyaw * alpha;
      }

      // Keep active vehicle guidance and trails synchronized during smooth animation frame
      if (this.selectedVehicleId && this.truckObjects[this.selectedVehicleId]) {
        const selItem = this.truckObjects[this.selectedVehicleId];
        if (selItem && selItem.mesh) {
          this.recordVehicleTrail(this.selectedVehicleId, selItem.mesh.position);
        }
      }
      this.updateActiveRouteHighlight();
      this.updateVehicleTrailsVisual();
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
