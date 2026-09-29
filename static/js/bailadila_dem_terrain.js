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
      this.vscale = 1.5;
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
      this.terrainGridHeights = null; // Exact Float32Array grid of rendered surface heights
      this.pitExcavationMesh = null;
      this.roadGroup = null;
      this.stockpileGroup = null;
      this.truckGroup = null;
      this.hazardGroup = null;
      this.obstacleGroup = null;
      this.obstacleObjects = {};
      this.landmarkGroup = null;
      this.roadCurvePoints = [];
      this.sampledRoad = [];
      this.stationIsSwitchback = [];
      this.roadClearance = 0.58 * 1.5;
      this.showRoadDebug = false;
      this.roadDebugGroup = null;
      this.activeCamera = null;
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

    _generateProceduralFallback() {
      const W = this.meta.width || 256;
      const H = this.meta.height || 256;
      this.rawElev = new Float32Array(W * H);
      const minE = this.meta.minElevationMeters || 220.0;
      const maxE = this.meta.maxElevationMeters || 1272.0;
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const nx = (i / (W - 1)) * 2 - 1;
          const ny = (j / (H - 1)) * 2 - 1;
          const r = Math.hypot(nx, ny);
          const hill = Math.exp(-r * r * 2.2);
          this.rawElev[j * W + i] = minE + (maxE - minE) * (0.30 + 0.55 * hill);
        }
      }
    }

    /**
     * Load metadata and 16-bit DEM heightmap with multiple fallback routes.
     */
    async load(metaUrl = '/static/bailadila_terrain_meta.json', pngUrl = '/static/bailadila_terrain_256.png') {
      try {
        // 1. Fetch metadata
        let metaRes = await fetch(metaUrl).catch(() => null);
        if (!metaRes || !metaRes.ok) {
          metaRes = await fetch('/bailadila_terrain_meta.json').catch(() => null);
        }
        if (metaRes && metaRes.ok) {
          const loadedMeta = await metaRes.json();
          this.meta = Object.assign(this.meta, loadedMeta);
          this._initProjections();
        }
      } catch (err) {
        console.warn('Using default Bailadila DEM metadata:', err);
      }

      // 2. Fetch PNG heightmap
      let decoded = false;
      try {
        let pngRes = await fetch(pngUrl).catch(() => null);
        if (!pngRes || !pngRes.ok) {
          pngRes = await fetch('/bailadila_terrain_256.png').catch(() => null);
        }
        if (pngRes && pngRes.ok) {
          const arrayBuf = await pngRes.arrayBuffer();
          await this._decode16BitPNG(arrayBuf);
          decoded = true;
        }
      } catch (err) {
        console.warn('Direct 16-bit PNG stream decode failed:', err);
      }

      if (!decoded) {
        try {
          await this._decodeWithCanvas(pngUrl);
          decoded = true;
        } catch (canvasErr) {
          try {
            await this._decodeWithCanvas('/bailadila_terrain_256.png');
            decoded = true;
          } catch (canvasErr2) {
            console.warn('Canvas fallback failed, activating procedural DEM heightmap:', canvasErr2);
            this._generateProceduralFallback();
          }
        }
      }

      // 3. Fetch canonical Deposit-14 simulation route
      try {
        let routeRes = await fetch('/api/simulation_route').catch(() => null);
        if (!routeRes || !routeRes.ok) {
          routeRes = await fetch('/bailadila_simulation_data.json').catch(() => null);
        }
        if (routeRes && routeRes.ok) {
          const rData = await routeRes.json();
          this.canonicalWaypoints = rData.waypoints || rData.SIM_WAYPOINTS || null;
        }
      } catch (err) {
        console.warn('Using embedded canonical simulation route:', err);
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
     * EXACT FACET HEIGHT OF RENDERED 3D TERRAIN
     * Barycentric interpolation within the active rendered triangular facet.
     * Prevents road clipping, tears, or cracking across any vertical exaggeration (vscale).
     */
    getRenderedTerrainHeight(x, z) {
      if (!this.terrainGridHeights) {
        return this.sampleCarvedElevationXZ(x, z);
      }
      const W = this.meta.width || 256;
      const H = this.meta.height || 256;

      const lon = this.lon0 + x / this.M_LON;
      const lat = this.lat0 - z / this.M_LAT;

      const fx = (lon - this.meta.west) / (this.meta.east - this.meta.west) * (W - 1);
      const fz = (this.meta.north - lat) / (this.meta.north - this.meta.south) * (H - 1);

      const i0 = Math.max(0, Math.min(W - 2, Math.floor(fx)));
      const j0 = Math.max(0, Math.min(H - 2, Math.floor(fz)));
      const tx = Math.max(0, Math.min(1, fx - i0));
      const tz = Math.max(0, Math.min(1, fz - j0));

      const ya = this.terrainGridHeights[j0 * W + i0];
      const yb = this.terrainGridHeights[j0 * W + (i0 + 1)];
      const yc = this.terrainGridHeights[(j0 + 1) * W + i0];
      const yd = this.terrainGridHeights[(j0 + 1) * W + (i0 + 1)];

      // Triangle 1: (a, c, b) where tx + tz <= 1.0; Triangle 2: (b, c, d) where tx + tz > 1.0
      if (tx + tz <= 1.0) {
        return ya + tx * (yb - ya) + tz * (yc - ya);
      } else {
        return yd + (1.0 - tx) * (yc - yd) + (1.0 - tz) * (yb - yd);
      }
    }

    /**
     * BUILD REAL 3D TERRAIN MESH
     * 256x256 dense vertex grid with distinct Surrounding Natural Landscape vs Active Open-Cast Iron Ore Mine.
     */
    buildTerrain(scene, vscale = 1.5) {
      this.vscale = vscale;
      if (this.terrainMesh && scene) {
        scene.remove(this.terrainMesh);
        if (this.terrainMesh.geometry) this.terrainMesh.geometry.dispose();
      }

      const W = this.meta.width || 256;
      const H = this.meta.height || 256;
      if (!this.terrainGridHeights || this.terrainGridHeights.length !== W * H) {
        this.terrainGridHeights = new Float32Array(W * H);
      }

      // PASS 1: Sample elevations for entire grid
      for (let j = 0; j < H; j++) {
        const lat = this.meta.north - (j / (H - 1)) * (this.meta.north - this.meta.south);
        for (let i = 0; i < W; i++) {
          const lon = this.meta.west + (i / (W - 1)) * (this.meta.east - this.meta.west);
          const finalH = this.sampleCarvedElevation(lon, lat);
          this.terrainGridHeights[j * W + i] = finalH;
        }
      }

      const geo = new THREE.BufferGeometry();
      const positions = [];
      const colors = [];
      const indices = [];

      // COLOR PALETTE HIERARCHY — REALISTIC OPEN-CAST IRON ORE DIGITAL TWIN
      // 1. Surrounding Natural Terrain (Lush Forest of Green — Dense Sal & Teak Mountain Canopy)
      const cNatValley      = new THREE.Color(0x1c441e); // Deep emerald valley forest canopy & river basin
      const cNatLowScrub    = new THREE.Color(0x255627); // Rich lush forest low slopes & foothills
      const cNatMidCanopy   = new THREE.Color(0x2d682e); // Dense mountain forest green
      const cNatRidgeScrub  = new THREE.Color(0x387e39); // Vibrant upland canopy green
      const cNatPeakStone   = new THREE.Color(0x2f6631); // High mountain ridge forest & lush plateau foliage

      // 2. Active Mine Disturbed Ground & Perimeter Margin (Stripped topsoil & bulldozed clay dirt)
      const cDisturbedClay  = new THREE.Color(0x4c3c31); // Stripped laterite clay margin
      const cDisturbedDust  = new THREE.Color(0x5c4b3d); // Bulldozed bench perimeter apron
      const cDisturbedRock  = new THREE.Color(0x3a3028); // Broken perimeter spoil rock

      // 3. Active Open-Cast Pit & Stepped Benches (Predominantly dark exposed rock, weathered quarry stone)
      const cBenchFloor     = new THREE.Color(0x3e352b); // Working horizontal bench floor (weathered quarry aggregate)
      const cBenchCrest     = new THREE.Color(0x56493c); // Subtle bench crest rim highlight
      const cRockFaceDark   = new THREE.Color(0x161311); // Steep excavated rock cut face (deep dark shadow rock)
      const cHematiteRich   = new THREE.Color(0x6a2517); // Banded hematite ore seam (rust-red, 10-20% coverage)
      const cIronbloomOre   = new THREE.Color(0x7a2f1b); // Oxidized earthy dark red iron ore lens
      const cPitSumpFloor   = new THREE.Color(0x161311); // Deep central pit loading sump floor

      // 4. Deposition Center & Spoil Pad (Waypoint 0 footprint — Muted brown / orange-gray overburden)
      const cDepotDark      = new THREE.Color(0x241e1a); // Compacted dark spoil pad & fine coal fines
      const cDepotRust      = new THREE.Color(0x453528); // Muted brown / orange-gray waste rock

      const minE = this.meta.minElevationMeters;
      const maxE = this.meta.maxElevationMeters;
      const eSpan = maxE - minE;

      // Deposition Center coordinate (Kirandul Yard: 81.2215°E, 18.5928°N)
      const yardGeoPos = this.lonLatToWorld(81.2215, 18.5928, 0);

      // Grid spacing in meters for accurate slope/gradient calculation
      const dxMeter = ((this.meta.east - this.meta.west) / (W - 1)) * this.M_LON;
      const dzMeter = ((this.meta.north - this.meta.south) / (H - 1)) * this.M_LAT;

      // Road waypoints for haul road incision staining
      const roadWaypoints = CANONICAL_DEPOSIT_14_WAYPOINTS.map(wp => {
        const p = this.lonLatToWorld(wp.lng, wp.lat, 0);
        return { x: p.x, z: p.z };
      });
      const numRoadWp = roadWaypoints.length;

      // PASS 2: Compute 3D geometry positions, slope gradient, and terrain strata colors
      for (let j = 0; j < H; j++) {
        const lat = this.meta.north - (j / (H - 1)) * (this.meta.north - this.meta.south);
        const jPrev = Math.max(0, j - 1);
        const jNext = Math.min(H - 1, j + 1);

        for (let i = 0; i < W; i++) {
          const lon = this.meta.west + (i / (W - 1)) * (this.meta.east - this.meta.west);
          const iPrev = Math.max(0, i - 1);
          const iNext = Math.min(W - 1, i + 1);

          const finalH = this.terrainGridHeights[j * W + i];
          const worldPos = this.lonLatToWorld(lon, lat, finalH, vscale);
          positions.push(worldPos.x, worldPos.y, worldPos.z);

          // Local slope calculation: dz and dx differences
          const hL = this.terrainGridHeights[j * W + iPrev];
          const hR = this.terrainGridHeights[j * W + iNext];
          const hU = this.terrainGridHeights[jPrev * W + i];
          const hD = this.terrainGridHeights[jNext * W + i];

          const slopeX = (hR - hL) / ((iNext - iPrev) * dxMeter || 1.0);
          const slopeZ = (hD - hU) / ((jNext - jPrev) * dzMeter || 1.0);
          const slopeMag = Math.hypot(slopeX, slopeZ); // Tangent of surface slope angle

          // Pit influence calculation
          const dx = worldPos.x - this.pitPos.x;
          const dz = worldPos.z - this.pitPos.z;
          const theta = Math.atan2(dz, dx);
          const rOrg = 1.0 + 0.12 * Math.cos(3 * theta + 0.5) + 0.08 * Math.sin(5 * theta - 0.7) + 0.04 * Math.cos(2 * theta);
          const uDist = Math.hypot(dx / this.pitRX, dz / this.pitRZ) / rOrg;

          // Deposition Center distance
          const distToYard = Math.hypot(worldPos.x - yardGeoPos.x, worldPos.z - yardGeoPos.z);
          const inDepotZone = distToYard < 220.0;

          // Road proximity check (within 18m of canonical haul circuit)
          let distToRoadMin = 9999.0;
          for (let rw = 0; rw < numRoadWp; rw++) {
            const p1 = roadWaypoints[rw];
            const p2 = roadWaypoints[(rw + 1) % numRoadWp];
            const l2 = (p2.x - p1.x) ** 2 + (p2.z - p1.z) ** 2;
            let t = l2 > 0 ? ((worldPos.x - p1.x) * (p2.x - p1.x) + (worldPos.z - p1.z) * (p2.z - p1.z)) / l2 : 0;
            t = Math.max(0, Math.min(1, t));
            const projX = p1.x + t * (p2.x - p1.x);
            const projZ = p1.z + t * (p2.z - p1.z);
            const d = Math.hypot(worldPos.x - projX, worldPos.z - projZ);
            if (d < distToRoadMin) distToRoadMin = d;
          }

          const col = new THREE.Color();
          const elevNorm = Math.max(0, Math.min(1, (finalH - minE) / eSpan));

          if (this.showPit && uDist < 0.88) {
            // ==============================================================
            // ZONE B: ACTIVE OPEN-CAST MINE PIT & STEPPED BENCHES
            // ==============================================================
            if (uDist < 0.15) {
              // Deepest Pit Floor (Excavation Sump Floor ~519m ASL)
              col.copy(cPitSumpFloor);
              const sumpVar = Math.sin(worldPos.x * 0.04 + worldPos.z * 0.04) * 0.02;
              col.offsetHSL(0, 0, sumpVar);
            } else {
              // Stepped Terraces (10 Benches with Working Floors, Crest Highlights, and Steep Cuts)
              const benchVal = (0.88 - uDist) / 0.73 * this.pitBenches;
              const benchIdx = Math.floor(benchVal);
              const benchFrac = benchVal - benchIdx; // 0.0 -> 1.0 within bench step

              // Is this point on the steep rock cut face, crest lip, or horizontal bench floor?
              const isSteepCut = (slopeMag > 0.30) || (benchFrac >= 0.65);
              const isCrestLip = (benchFrac < 0.09) && (slopeMag > 0.18);

              if (isSteepCut) {
                // Steep Rock Face Cut: Predominantly dark exposed quarry rock
                col.copy(cRockFaceDark);

                // Strata Layering (horizontal banded iron formation)
                const strataBand = Math.sin(finalH * 0.32) * 0.5 + 0.5;

                // Concentrated strictly along exposed East reef walls and selective lower cuts
                const isEastOreZone = (worldPos.x > this.pitPos.x - 30) && (worldPos.z > this.pitPos.z - 320) && (worldPos.z < this.pitPos.z + 260);
                const isOreSeam = isEastOreZone && (strataBand > 0.62);

                if (isOreSeam) {
                  // High-grade hematite and oxidized rust-red ore seam (approx 12-15% of pit face area)
                  const oreMix = (strataBand - 0.62) / 0.38;
                  const oreColor = cHematiteRich.clone().lerp(cIronbloomOre, strataBand);
                  col.lerp(oreColor, oreMix * 0.85);
                } else {
                  // Weathered dark quarry stone cut with subtle strata grain
                  col.lerp(new THREE.Color(0x26211c), strataBand * 0.35);
                }

                // Slope-based shading / contact shadows on steep cuts to make stepped terraces visually pop
                col.multiplyScalar(0.65);
              } else if (isCrestLip) {
                // Subtle bench crest highlight (freshly blasted rock rim)
                col.copy(cBenchCrest);
              } else {
                // Horizontal Working Bench Floor: Weathered quarry aggregate & equipment tracks
                col.copy(cBenchFloor);

                // Subtle quarry dust variation along bench floor
                const benchVein = Math.sin(benchVal * 3.14159) * 0.5 + 0.5;
                if (benchVein > 0.75) {
                  col.lerp(cDisturbedDust, (benchVein - 0.75) * 0.4);
                }
                // Bench floor rock grain
                const grain = (Math.sin(worldPos.x * 0.05 + worldPos.z * 0.05) * 0.5) * 0.02;
                col.offsetHSL(0, 0, grain);
              }
            }

            // Haul Road bed cut staining (if directly beneath or adjacent to haul road corridor)
            if (distToRoadMin < 11.5) {
              const roadStain = 1.0 - (distToRoadMin / 11.5);
              col.lerp(new THREE.Color(0x14110f), roadStain * 0.85);
            }

          } else if (inDepotZone) {
            // ==============================================================
            // ZONE D: DEPOSITION / DUMP AREA (Kirandul Stockpile Yard)
            // ==============================================================
            const depotBlend = 1.0 - Math.min(1.0, distToYard / 220.0);
            col.copy(cDepotDark).lerp(cDepotRust, depotBlend * 0.75);

            // Layered spoil mounds texture in muted brown/dark rock tones
            const moundNoise = Math.sin(worldPos.x * 0.03) * Math.cos(worldPos.z * 0.03);
            if (moundNoise > 0.35) {
              col.lerp(cDisturbedRock, (moundNoise - 0.35) * 0.5);
            }

            if (distToRoadMin < 18.0) {
              const roadStain = 1.0 - (distToRoadMin / 18.0);
              col.lerp(new THREE.Color(0x14110f), roadStain * 0.82);
            }

          } else if (this.showPit && uDist < 1.15) {
            // ==============================================================
            // ZONE B/A TRANSITION: DISTURBED GROUND / MINE PERIMETER
            // ==============================================================
            // Blends naturally from lush forest green into cleared laterite clay & perimeter berms
            const marginFrac = (1.15 - uDist) / (1.15 - 0.88); // 0.0 at lush forest -> 1.0 at pit rim

            // Natural forest baseline at this elevation
            let natBase;
            if (elevNorm < 0.35) {
              natBase = cNatLowScrub.clone().lerp(cNatMidCanopy, elevNorm / 0.35);
            } else {
              natBase = cNatMidCanopy.clone().lerp(cNatRidgeScrub, (elevNorm - 0.35) / 0.65);
            }

            // Disturbed laterite ground target
            const distTarget = cDisturbedClay.clone().lerp(cDisturbedDust, Math.sin(worldPos.x * 0.02) * 0.5 + 0.5);
            col.copy(natBase).lerp(distTarget, marginFrac * 0.94);

            // Haul road cut entering the mine rim
            if (distToRoadMin < 18.0) {
              const roadStain = 1.0 - (distToRoadMin / 18.0);
              col.lerp(new THREE.Color(0x14110f), roadStain * 0.82);
            }

          } else {
            // ==============================================================
            // ZONE A: SURROUNDING / NATURAL TERRAIN (Lush Forest of Green)
            // ==============================================================
            if (elevNorm < 0.25) {
              // Low valley floor & river basin: Deep emerald forest canopy
              col.copy(cNatValley).lerp(cNatLowScrub, elevNorm / 0.25);
            } else if (elevNorm < 0.55) {
              // Lower to mid mountain slopes: Rich lush green canopy
              const q = (elevNorm - 0.25) / 0.30;
              col.copy(cNatLowScrub).lerp(cNatMidCanopy, q);
            } else if (elevNorm < 0.80) {
              // Upper mountain ridges: Vibrant tropical forest foliage
              const q = (elevNorm - 0.55) / 0.25;
              col.copy(cNatMidCanopy).lerp(cNatRidgeScrub, q);
            } else {
              // High mountain crests & peaks: Lush high-elevation mountain forest
              const q = (elevNorm - 0.80) / 0.20;
              col.copy(cNatRidgeScrub).lerp(cNatPeakStone, q);
            }

            // Natural organic canopy variation (deep emerald patches, sunlit treetops, and canopy shadows)
            const foliageNoise = Math.sin(worldPos.x * 0.006 + 1.2) * Math.cos(worldPos.z * 0.006 + 0.7);
            const foliageNoise2 = Math.sin(worldPos.x * 0.016 - 0.8) * Math.sin(worldPos.z * 0.016 + 0.3);
            col.offsetHSL(0.015 * foliageNoise, 0.06 * foliageNoise2, 0.03 * foliageNoise);

            // Access road cut through natural terrain if road crosses here
            if (distToRoadMin < 18.0) {
              const roadStain = 1.0 - (distToRoadMin / 18.0);
              col.lerp(new THREE.Color(0x1a1613), roadStain * 0.80);
            }
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
        roughness: 0.92,
        metalness: 0.05,
        flatShading: false
      });

      this.terrainMesh = new THREE.Mesh(geo, mat);
      this.terrainMesh.name = 'BailadilaDEMTerrain';
      if (scene) {
        this.scene = scene;
        scene.add(this.terrainMesh);
      }

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
    buildHaulRoads(scene, vscale = 1.5, waypoints = null) {
      if (scene) this.scene = scene;
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

      // 1. Generate dense stations along the exact waypoint segments (~4.5m spacing)
      // Guarantees ROAD PATH == VEHICLE TELEMETRY ROUTE with zero deviation.
      const stations = [];
      const stationIsSwitchback = [];
      for (let i = 0; i < numWp; i++) {
        const p1 = worldWaypoints[i];
        const p2 = worldWaypoints[(i + 1) % numWp];
        const segDist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
        const nSteps = Math.max(10, Math.round(segDist / 4.5));
        const isSwitchbackWp = (i === 3 || i === 5 || i === 11 || i === 13);
        const prevWp = (i - 1 + numWp) % numWp;
        const prevIsSwitchback = (prevWp === 3 || prevWp === 5 || prevWp === 11 || prevWp === 13);
        for (let s = 0; s < nSteps; s++) {
          const t = s / nSteps;
          const sx = p1.x + (p2.x - p1.x) * t;
          const sz = p1.z + (p2.z - p1.z) * t;
          const h = this.getRenderedTerrainHeight(sx, sz);
          const sy = (h - this.yMin) * vscale;
          stations.push(new THREE.Vector3(sx, sy, sz));
          stationIsSwitchback.push(isSwitchbackWp || (t < 0.3 && prevIsSwitchback));
        }
      }
      this.sampledRoad = stations;
      this.stationIsSwitchback = stationIsSwitchback;
      this.roadClearance = 0.58 * Math.max(1.0, vscale);
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

      // 3. Construct 7-Column Conforming Physical Haul Road Mesh
      // Standard dual-lane haul road: 28m wide (14m half-width).
      // Hairpin switchbacks: expanded to 38m wide (19m half-width) for heavy mining truck turning pads.
      const basePositions = [];
      const baseColors = [];
      const baseIndices = [];

      // Open-Cast Mining Haul Road Color Palette:
      // Outer shoulders: crushed quarry berm gravel (#52463a)
      // Road verges: crushed rock edge (#342c25)
      // Travel lanes: dark heavy-rolled compacted haul earth (#1a1613)
      // Center crown: weathered dark haul surface (#120f0d)
      const cShoulder = new THREE.Color(0x52463a);
      const cVerge = new THREE.Color(0x342c25);
      const cLane = new THREE.Color(0x1a1613);
      const cCenter = new THREE.Color(0x120f0d);

      const colColors = [cShoulder, cVerge, cLane, cCenter, cLane, cVerge, cShoulder];
      const normOffsets = [-1.0, -0.72, -0.36, 0.0, 0.36, 0.72, 1.0];
      const crowns = [0.00, 0.03, 0.06, 0.08, 0.06, 0.03, 0.00];

      for (let i = 0; i < numStations; i++) {
        const p = stations[i];
        const norm = this.sampledNormals[i];
        const halfW = stationIsSwitchback[i] ? 19.0 : 14.0;

        for (let c = 0; c < 7; c++) {
          const vx = p.x + norm.x * (normOffsets[c] * halfW);
          const vz = p.z + norm.z * (normOffsets[c] * halfW);
          // Sample exact rendered facet terrain elevation at each individual vertex
          const facetH = this.getRenderedTerrainHeight(vx, vz);
          const elev = (facetH - this.yMin) * vscale;
          // Offset above terrain scaled with vscale to eliminate facet clipping
          const clearance = 0.58 * Math.max(1.0, vscale);
          const vy = elev + clearance + crowns[c];

          basePositions.push(vx, vy, vz);
          baseColors.push(colColors[c].r, colColors[c].g, colColors[c].b);
        }

        if (i > 0) {
          const curBase = i * 7;
          const prevBase = (i - 1) * 7;
          for (let q = 0; q < 6; q++) {
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
        const prevBase = (numStations - 1) * 7;
        for (let q = 0; q < 6; q++) {
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
        roughness: 0.96,
        metalness: 0.03,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3.0,
        polygonOffsetUnits: -6.0
      });
      this.roadBaseMesh = new THREE.Mesh(roadGeo, roadMat);
      this.roadBaseMesh.name = 'HaulRoadBase';
      this.roadBaseMesh.receiveShadow = true;
      this.roadGroup.add(this.roadBaseMesh);

      // 4. Physical Quarry Rock Safety Berm Boulders along switchbacks & steep bench edges
      const bermMat = new THREE.MeshStandardMaterial({ color: 0x3d3227, roughness: 0.96 });
      const bermGeo = new THREE.BoxGeometry(2.4, 2.0, 3.8);
      for (let s = 3; s < numStations; s += 8) {
        const p = stations[s];
        const norm = this.sampledNormals[s];
        const halfW = stationIsSwitchback[s] ? 19.0 : 14.0;
        const bx = p.x + norm.x * (halfW + 1.2);
        const bz = p.z + norm.z * (halfW + 1.2);
        const by = (this.getRenderedTerrainHeight(bx, bz) - this.yMin) * vscale + 1.1 * Math.max(1.0, vscale);
        const berm = new THREE.Mesh(bermGeo, bermMat);
        berm.position.set(bx, by, bz);
        const tang = this.sampledTangents[s];
        berm.rotation.y = Math.atan2(tang.x, tang.z) + (Math.sin(s) * 0.15);
        this.roadGroup.add(berm);
      }

      // Build massive designated Deposition Center / Stockpile Yard at Waypoint 0
      this.buildStockpileYard(scene, vscale);

      if (scene) scene.add(this.roadGroup);
      return this.roadGroup;
    }

    /**
     * MASSIVE DESIGNATED OPEN-CAST MINE DEPOSITION CENTER & STOCKPILE YARD
     * Engineering-standardized coal & iron ore deposition area at Kirandul Dispatch Terminal (Waypoint 0).
     * Visual scale: approximately 10-12x the footprint of an ultra-class mining truck (~240m x 190m).
     * Realistic muted brown / dark rock overburden tones, layered spoil mounds, safety bunds, and CHP hopper.
     */
    buildStockpileYard(scene, vscale = 1.5) {
      if (this.stockpileGroup && scene) {
        scene.remove(this.stockpileGroup);
      }
      this.stockpileGroup = new THREE.Group();
      this.stockpileGroup.name = 'StockpileYardZone';

      // Center at canonical KIRANDUL_YARD (WP 0: 81.2215°E, 18.5928°N)
      const wpYard = CANONICAL_DEPOSIT_14_WAYPOINTS[0];
      const yardCenter = this.lonLatToWorld(wpYard.lng, wpYard.lat, 0);
      const groundH = this.getRenderedTerrainHeight(yardCenter.x, yardCenter.z);
      const groundY = (groundH - this.yMin) * vscale;

      // 1. Broad Multi-Tiered Dumping Apron Pad (240m x 190m extent)
      const padGeo = new THREE.CylinderGeometry(90, 105, 1.4 * Math.max(0.8, vscale), 40);
      const padMat = new THREE.MeshStandardMaterial({
        color: 0x241e1a,
        roughness: 0.96,
        metalness: 0.04
      });
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.scale.set(1.35, 1.0, 1.05); // Broad irregular footprint
      pad.position.set(yardCenter.x, groundY + 0.45 * vscale, yardCenter.z);
      pad.receiveShadow = true;
      this.stockpileGroup.add(pad);

      // Elevated Dumping Spoil Terrace (Raised working bench where trucks discharge)
      const terraceGeo = new THREE.BoxGeometry(105, 3.8 * Math.max(0.8, vscale), 55);
      const terraceMat = new THREE.MeshStandardMaterial({
        color: 0x36291e,
        roughness: 0.96
      });
      const terrace = new THREE.Mesh(terraceGeo, terraceMat);
      terrace.position.set(yardCenter.x + 8.0, groundY + 2.0 * vscale, yardCenter.z - 12.0);
      this.stockpileGroup.add(terrace);

      // 2. Realistic Safety Guide Berm Boulders around apron perimeter (replaces neon ring)
      const guideBermGeo = new THREE.BoxGeometry(3.6, 2.0, 5.0);
      const guideBermMat = new THREE.MeshStandardMaterial({ color: 0x483a2e, roughness: 0.95 });
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const bx = yardCenter.x + Math.cos(ang) * 88.0 * 1.35;
        const bz = yardCenter.z + Math.sin(ang) * 88.0 * 1.05;
        const by = (this.getRenderedTerrainHeight(bx, bz) - this.yMin) * vscale + 1.0 * Math.max(0.8, vscale);
        const berm = new THREE.Mesh(guideBermGeo, guideBermMat);
        berm.position.set(bx, by, bz);
        berm.rotation.y = -ang + Math.PI / 2;
        this.stockpileGroup.add(berm);
      }

      // 3. Massive Primary Raw Coal Stockpile Ridge (80m length, 22m high)
      const coalGeo = new THREE.ConeGeometry(40, 22.0 * Math.max(0.7, vscale), 28);
      const coalMat = new THREE.MeshStandardMaterial({
        color: 0x141416,
        roughness: 0.98,
        metalness: 0.04
      });
      const coalMound = new THREE.Mesh(coalGeo, coalMat);
      coalMound.scale.set(1.45, 1.0, 0.85); // Elongated coal ridge
      const cOffX = -42.0, cOffZ = -30.0;
      const coalH = this.getRenderedTerrainHeight(yardCenter.x + cOffX, yardCenter.z + cOffZ);
      coalMound.position.set(
        yardCenter.x + cOffX,
        (coalH - this.yMin) * vscale + 11.0 * Math.max(0.7, vscale),
        yardCenter.z + cOffZ
      );
      coalMound.rotation.y = 0.35;
      this.stockpileGroup.add(coalMound);

      // 4. Massive High-Grade Hematite Iron Ore Stockpile (64m diameter, 18m high)
      const oreGeo = new THREE.ConeGeometry(32, 18.0 * Math.max(0.7, vscale), 24);
      const oreMat = new THREE.MeshStandardMaterial({
        color: 0x6a2517, // Rich dark hematite
        roughness: 0.95,
        metalness: 0.08
      });
      const oreMound = new THREE.Mesh(oreGeo, oreMat);
      const oOffX = 46.0, oOffZ = -26.0;
      const oreH = this.getRenderedTerrainHeight(yardCenter.x + oOffX, yardCenter.z + oOffZ);
      oreMound.position.set(
        yardCenter.x + oOffX,
        (oreH - this.yMin) * vscale + 9.0 * Math.max(0.7, vscale),
        yardCenter.z + oOffZ
      );
      this.stockpileGroup.add(oreMound);

      // 5. Blended Sinter Feed Ore Mound (54m diameter, 14m high - muted brown)
      const sinterGeo = new THREE.ConeGeometry(27, 14.0 * Math.max(0.7, vscale), 20);
      const sinterMat = new THREE.MeshStandardMaterial({
        color: 0x543924, // Muted earthy brown
        roughness: 0.95
      });
      const sinterMound = new THREE.Mesh(sinterGeo, sinterMat);
      const sOffX = -38.0, sOffZ = 34.0;
      const sinterH = this.getRenderedTerrainHeight(yardCenter.x + sOffX, yardCenter.z + sOffZ);
      sinterMound.position.set(
        yardCenter.x + sOffX,
        (sinterH - this.yMin) * vscale + 7.0 * Math.max(0.7, vscale),
        yardCenter.z + sOffZ
      );
      this.stockpileGroup.add(sinterMound);

      // 6. Active Run-of-Mine Overburden Spoil Bank Finger (52m x 26m)
      const spoilGeo = new THREE.BoxGeometry(52, 9.0 * Math.max(0.7, vscale), 26);
      const spoilMat = new THREE.MeshStandardMaterial({
        color: 0x382c20, // Weathered spoil rock
        roughness: 0.96
      });
      const spoilMound = new THREE.Mesh(spoilGeo, spoilMat);
      const spOffX = 46.0, spOffZ = 34.0;
      const spoilH = this.getRenderedTerrainHeight(yardCenter.x + spOffX, yardCenter.z + spOffZ);
      spoilMound.position.set(
        yardCenter.x + spOffX,
        (spoilH - this.yMin) * vscale + 4.5 * Math.max(0.7, vscale),
        yardCenter.z + spOffZ
      );
      spoilMound.rotation.y = -0.22;
      this.stockpileGroup.add(spoilMound);

      // 7. Coal Handling Plant (CHP) Dual-Bay Dump Pocket & Receiving Hopper
      const hopperH = this.getRenderedTerrainHeight(yardCenter.x + 2.0, yardCenter.z + 16.0);
      const hopperY = (hopperH - this.yMin) * vscale;
      const hopperGeo = new THREE.BoxGeometry(34, 13 * Math.max(0.7, vscale), 24);
      const hopperMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.65,
        metalness: 0.45
      });
      const hopper = new THREE.Mesh(hopperGeo, hopperMat);
      hopper.position.set(yardCenter.x + 2.0, hopperY + 6.5 * Math.max(0.7, vscale), yardCenter.z + 16.0);
      this.stockpileGroup.add(hopper);

      // Dual heavy steel grizzly grate screens over hopper bays
      const grizzlyGeo = new THREE.BoxGeometry(32, 1.2, 22);
      const grizzlyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6, metalness: 0.8 });
      const grizzly = new THREE.Mesh(grizzlyGeo, grizzlyMat);
      grizzly.position.set(yardCenter.x + 2.0, hopperY + 13.1 * Math.max(0.7, vscale), yardCenter.z + 16.0);
      this.stockpileGroup.add(grizzly);

      // Safety wheel stop bunds along dump bay lip
      const curbGeo = new THREE.BoxGeometry(30, 2.6, 2.2);
      const curbMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5 });
      const curb = new THREE.Mesh(curbGeo, curbMat);
      curb.position.set(yardCenter.x + 2.0, hopperY + 14.4 * Math.max(0.7, vscale), yardCenter.z + 4.8);
      this.stockpileGroup.add(curb);

      // Dual elevated truss conveyor gantries heading towards plant
      const gantryGeo = new THREE.BoxGeometry(5.5, 5.5, 75);
      const gantryMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.5, roughness: 0.6 });
      const gantry1 = new THREE.Mesh(gantryGeo, gantryMat);
      gantry1.position.set(yardCenter.x - 3.5, hopperY + 17.0 * Math.max(0.7, vscale), yardCenter.z + 52.0);
      gantry1.rotation.x = -0.16;
      this.stockpileGroup.add(gantry1);
      const gantry2 = new THREE.Mesh(gantryGeo, gantryMat);
      gantry2.position.set(yardCenter.x + 7.5, hopperY + 17.0 * Math.max(0.7, vscale), yardCenter.z + 52.0);
      gantry2.rotation.x = -0.16;
      this.stockpileGroup.add(gantry2);

      // 8. Four 18m High-Mast Floodlight Towers illuminating deposition bays
      const towerGeo = new THREE.CylinderGeometry(0.5, 0.8, 18.0, 8);
      const towerMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.7 });
      const headGeo = new THREE.BoxGeometry(3.5, 1.0, 2.5);
      const headMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
      const towerCoords = [
        [-52.0, -42.0], [56.0, -38.0], [-54.0, 48.0], [54.0, 46.0]
      ];
      towerCoords.forEach(([tx, tz]) => {
        const th = this.getRenderedTerrainHeight(yardCenter.x + tx, yardCenter.z + tz);
        const ty = (th - this.yMin) * vscale;
        const pole = new THREE.Mesh(towerGeo, towerMat);
        pole.position.set(yardCenter.x + tx, ty + 9.0, yardCenter.z + tz);
        const lamp = new THREE.Mesh(headGeo, headMat);
        lamp.position.set(yardCenter.x + tx, ty + 18.2, yardCenter.z + tz);
        this.stockpileGroup.add(pole);
        this.stockpileGroup.add(lamp);
      });

      // 9. Perimeter Guide Stanchions with Subtle Low-Intensity Beacons (12 stanchions)
      const poleGeo = new THREE.CylinderGeometry(0.35, 0.35, 5.5, 8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.7 });
      const beaconGeo = new THREE.SphereGeometry(0.8, 8, 8);
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xd97706 });
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const bx = yardCenter.x + Math.cos(ang) * 82.0 * 1.35;
        const bz = yardCenter.z + Math.sin(ang) * 82.0 * 1.05;
        const by = (this.getRenderedTerrainHeight(bx, bz) - this.yMin) * vscale;
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(bx, by + 2.75, bz);
        const beacon = new THREE.Mesh(beaconGeo, beaconMat);
        beacon.position.set(bx, by + 5.7, bz);
        this.stockpileGroup.add(pole);
        this.stockpileGroup.add(beacon);
      }

      // 10. Floating 3D Billboard Sprite Badge: "DEPOSITION CENTER & STOCKPILE YARD"
      const canvas = document.createElement('canvas');
      canvas.width = 580;
      canvas.height = 120;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(10, 15, 26, 0.90)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(4, 4, 572, 112, 12);
      else ctx.rect(4, 4, 572, 112);
      ctx.fill();
      ctx.strokeStyle = 'rgba(201, 162, 39, 0.75)';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 18px "Space Grotesk", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('COAL & ORE PROCESSING — KIRANDUL COMPLEX', 290, 32);

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 34px "Space Grotesk", sans-serif';
      ctx.fillText('DEPOSITION & STOCKPILE YARD', 290, 72);

      ctx.fillStyle = '#10b981';
      ctx.font = '600 17px "IBM Plex Mono", monospace';
      ctx.fillText('● ACTIVE RECEIVING HOPPER & UNLOADING PAD', 290, 102);

      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(yardCenter.x, groundY + 52.0 * Math.max(0.8, vscale), yardCenter.z);
      sprite.scale.set(115, 24, 1);
      this.stockpileGroup.add(sprite);

      if (scene) scene.add(this.stockpileGroup);
      return this.stockpileGroup;
    }

    /**
     * SELECT ACTIVE VEHICLE
     * Updates selected state, ground halo, leader line color, and 3D DMP label border.
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

      for (const k in this.truckObjects) {
        const item = this.truckObjects[k];
        if (!item || !item.mesh) continue;
        const isSel = (k === matchedKey);
        if (item.mesh.selectionRing) {
          item.mesh.selectionRing.visible = isSel;
        }
        if (item.mesh.leaderLine && item.mesh.leaderLine.material) {
          item.mesh.leaderLine.material.color.setHex(isSel ? 0x38bdf8 : 0xc9a227);
        }
        const bData = item.backendData || {};
        const spd = bData.speed_kmh || (item.speedMps ? item.speedMps * 3.6 : 0);
        const action = bData.action || (item.isMoving ? 'MOVING' : 'STOP');
        this.drawTruckLabel(item.mesh, item.idText, k, spd, action, isSel);
      }
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
     * Nearest Haul-Road Station & Segment Projection
     * Finds the closest point on this.sampledRoad and computes local tangent,
     * normal, lateral distance from centerline, and switchback status.
     */
    getNearestRoadPoint(x, z) {
      if (!this.sampledRoad || !this.sampledRoad.length) {
        return {
          point: new THREE.Vector3(x, 0, z),
          tangent: new THREE.Vector3(0, 0, 1),
          normal: new THREE.Vector3(-1, 0, 0),
          lateralDist: 999.0,
          halfWidth: 14.0,
          isSwitchback: false,
          stationIdx: 0,
          segmentT: 0
        };
      }

      const stations = this.sampledRoad;
      const numStations = stations.length;

      // 1. Find nearest road station index
      let closestIdx = 0;
      let minStationDistSq = Infinity;
      for (let i = 0; i < numStations; i++) {
        const p = stations[i];
        const dx = p.x - x;
        const dz = p.z - z;
        const dsq = dx * dx + dz * dz;
        if (dsq < minStationDistSq) {
          minStationDistSq = dsq;
          closestIdx = i;
        }
      }

      // 2. Test adjacent segments [closestIdx - 1, closestIdx] and [closestIdx, closestIdx + 1]
      let bestDistSq = Infinity;
      let bestProj = new THREE.Vector3();
      let bestTangent = new THREE.Vector3(0, 0, 1);
      let bestNormal = new THREE.Vector3(-1, 0, 0);
      let bestT = 0;
      let isSwitchback = (this.stationIsSwitchback && this.stationIsSwitchback[closestIdx]) || false;

      for (let s = -2; s <= 2; s++) {
        const i0 = (closestIdx + s + numStations) % numStations;
        const i1 = (i0 + 1) % numStations;
        const p0 = stations[i0];
        const p1 = stations[i1];

        const segDx = p1.x - p0.x;
        const segDz = p1.z - p0.z;
        const segLsq = segDx * segDx + segDz * segDz;
        if (segLsq < 1e-6) continue;

        let u = ((x - p0.x) * segDx + (z - p0.z) * segDz) / segLsq;
        u = Math.max(0.0, Math.min(1.0, u));

        const px = p0.x + u * segDx;
        const pz = p0.z + u * segDz;
        const py = p0.y + u * (p1.y - p0.y);

        const dsq = (x - px) * (x - px) + (z - pz) * (z - pz);
        if (dsq < bestDistSq) {
          bestDistSq = dsq;
          bestProj.set(px, py, pz);
          bestT = u;
          const tangL = Math.hypot(segDx, segDz);
          if (tangL > 1e-4) {
            bestTangent.set(segDx / tangL, 0, segDz / tangL);
            bestNormal.set(-bestTangent.z, 0, bestTangent.x);
          }
          if (this.stationIsSwitchback) {
            isSwitchback = this.stationIsSwitchback[i0] || this.stationIsSwitchback[i1];
          }
        }
      }

      const lateralDist = Math.sqrt(bestDistSq);
      const halfWidth = isSwitchback ? 19.0 : 14.0;

      return {
        point: bestProj,
        tangent: bestTangent,
        normal: bestNormal,
        lateralDist,
        halfWidth,
        isSwitchback,
        stationIdx: closestIdx,
        segmentT: bestT
      };
    }

    /**
     * Physical Haul-Road Surface Height Lookup (Requirement 2)
     * Returns the exact Y coordinate of the rendered haul-road surface at (x, z).
     * Inside the road corridor (14m standard, 19m switchback), elevation is strictly derived from the
     * canonical haul-road station centerline elevation (info.point.y + clearance + crown)
     * instead of raw DEM terrain facets.
     * Outside the road corridor, smoothly falls back to rendered terrain elevation.
     */
    getHaulRoadSurfaceAt(x, z) {
      if (!this.sampledRoad || !this.sampledRoad.length) {
        return (this.getRenderedTerrainHeight(x, z) - this.yMin) * this.vscale;
      }

      const info = this.getNearestRoadPoint(x, z);
      const clearance = (this.roadClearance !== undefined)
        ? this.roadClearance
        : (0.58 * Math.max(1.0, this.vscale));

      const roadCenterY = info.point.y + clearance;
      const halfW = info.halfWidth;
      const dist = info.lateralDist;

      if (dist <= halfW) {
        // Road surface crown profile: parabolic crown up to +0.08m at centerline
        const normD = dist / halfW;
        const crown = 0.08 * (1.0 - normD * normD);
        return roadCenterY + crown;
      } else if (dist <= halfW + 4.0) {
        // Shoulder transition blend down to natural terrain
        const blend = (dist - halfW) / 4.0;
        const naturalTerrainY = (this.getRenderedTerrainHeight(x, z) - this.yMin) * this.vscale;
        return roadCenterY * (1.0 - blend) + naturalTerrainY * blend;
      } else {
        return (this.getRenderedTerrainHeight(x, z) - this.yMin) * this.vscale;
      }
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
     * PROCEDURAL HEAVY MINING HAUL TRUCK (CAT 797F / KOMATSU 930E CLASS)
     * High-fidelity industrial digital-twin mining dump truck with sloped bed side walls (~18°),
     * structural ribs, rock canopy, elevated cab, windshield, radiator grille, mudguards,
     * planetary wheel hubs, contact shadow, vertical leader line, and high-visibility 3D DMP label.
     */
    createMiningTruck(primaryId, secondaryId = 'TRUCK', colorHex = 0xd49b28) {
      const truck = new THREE.Group();
      truck.name = primaryId;

      // Realistic Mining Dump Truck Dimensions (proportional to 28m standard / 38m switchback haul road):
      // Width = 9.8m, Length = 15.2m, Height = 7.6m
      const wheelR = 2.0;
      const wheelW = 1.45;
      const Lhalf = 4.5;
      const Whalf = 4.2;

      // Materials
      const steelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, metalness: 0.3 });
      const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
      const truckYellowMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, metalness: 0.1 });
      const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.94 });
      const hubMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5, metalness: 0.6 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.15, metalness: 0.85 });

      // 1. Box-Section Ladder Chassis
      const chassisGeo = new THREE.BoxGeometry(4.8, 1.4, 13.0);
      const chassis = new THREE.Mesh(chassisGeo, steelMat);
      chassis.position.set(0, 2.7, 0);
      truck.add(chassis);

      // Heavy Front Bumper & Push Block
      const bumperGeo = new THREE.BoxGeometry(9.4, 1.8, 2.0);
      const bumper = new THREE.Mesh(bumperGeo, darkMetalMat);
      bumper.position.set(0, 2.2, 5.8);
      truck.add(bumper);

      // Front Access Diagonal Walkway & Steps
      const stepGeo = new THREE.BoxGeometry(1.6, 2.2, 1.4);
      const step = new THREE.Mesh(stepGeo, steelMat);
      step.position.set(3.4, 2.2, 5.6);
      truck.add(step);

      // 2. Six Mining Wheels with Planetary Final-Drive Hubs
      // Local Y of wheel center = wheelR (2.0m), so bottom of tire touches exact local Y = 0.0
      const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 20);
      wheelGeo.rotateZ(Math.PI / 2);
      const hubGeo = new THREE.CylinderGeometry(wheelR * 0.44, wheelR * 0.44, wheelW + 0.12, 16);
      hubGeo.rotateZ(Math.PI / 2);

      const wheelPositions = [
        // Front Steer Axle (Z = +4.5m)
        [-Whalf, wheelR, Lhalf],
        [ Whalf, wheelR, Lhalf],
        // Rear Dual Drive Axle (Z = -4.5m)
        [-Whalf - 0.7, wheelR, -Lhalf],
        [-Whalf + 0.9, wheelR, -Lhalf],
        [ Whalf - 0.9, wheelR, -Lhalf],
        [ Whalf + 0.7, wheelR, -Lhalf]
      ];

      wheelPositions.forEach(pos => {
        const wGroup = new THREE.Group();
        const tire = new THREE.Mesh(wheelGeo, tireMat);
        const hub = new THREE.Mesh(hubGeo, hubMat);
        wGroup.add(tire);
        wGroup.add(hub);
        wGroup.position.set(...pos);
        truck.add(wGroup);
      });

      // Front & Rear Mudguards
      const fgGeo = new THREE.BoxGeometry(1.8, 0.4, 4.2);
      const fgL = new THREE.Mesh(fgGeo, steelMat);
      fgL.position.set(-Whalf, 4.1, Lhalf);
      truck.add(fgL);
      const fgR = new THREE.Mesh(fgGeo, steelMat);
      fgR.position.set(Whalf, 4.1, Lhalf);
      truck.add(fgR);

      // 3. Elevated Operator Cabin (Front-Left Deck)
      const cabGeo = new THREE.BoxGeometry(3.2, 2.8, 3.4);
      const cab = new THREE.Mesh(cabGeo, truckYellowMat);
      cab.position.set(-2.8, 4.9, 3.8);
      truck.add(cab);

      // Cab Windshield (Forward-sloped tinted safety glass)
      const winGeo = new THREE.BoxGeometry(2.8, 1.4, 0.3);
      const win = new THREE.Mesh(winGeo, glassMat);
      win.position.set(-2.8, 5.3, 5.52);
      win.rotation.x = 0.08;
      truck.add(win);

      // Side Windows
      const sideWinGeo = new THREE.BoxGeometry(0.3, 1.2, 2.0);
      const sideWinL = new THREE.Mesh(sideWinGeo, glassMat);
      sideWinL.position.set(-4.42, 5.3, 3.8);
      truck.add(sideWinL);

      // Radiator Enclosure & Hood (Front-Right Deck)
      const engGeo = new THREE.BoxGeometry(4.2, 2.4, 3.6);
      const eng = new THREE.Mesh(engGeo, steelMat);
      eng.position.set(2.1, 4.3, 3.8);
      truck.add(eng);

      // Front Grille
      const grilleGeo = new THREE.BoxGeometry(3.8, 1.8, 0.3);
      const grille = new THREE.Mesh(grilleGeo, darkMetalMat);
      grille.position.set(2.1, 4.3, 5.66);
      truck.add(grille);

      // Headlights on bumper
      const hlGeo = new THREE.BoxGeometry(0.9, 0.6, 0.3);
      const hlMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
      const hlL = new THREE.Mesh(hlGeo, hlMat);
      hlL.position.set(-3.8, 2.8, 6.82);
      truck.add(hlL);
      const hlR = new THREE.Mesh(hlGeo, hlMat);
      hlR.position.set( 3.8, 2.8, 6.82);
      truck.add(hlR);

      // Twin Exhaust Stacks
      const exhGeo = new THREE.CylinderGeometry(0.22, 0.22, 3.2, 10);
      const exhMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
      const exh = new THREE.Mesh(exhGeo, exhMat);
      exh.position.set(-1.0, 5.8, 1.6);
      truck.add(exh);

      // 4. Heavy Articulated Dump Bed with Visibly Sloped Side Walls (~18°)
      const bedPivot = new THREE.Group();
      bedPivot.name = 'BedPivot';
      const hingeY = 3.4;
      const hingeZ = -Lhalf;
      bedPivot.position.set(0, hingeY, hingeZ);

      // Dump Bed Floor Plate
      const floorGeo = new THREE.BoxGeometry(7.2, 0.5, 11.2);
      const floor = new THREE.Mesh(floorGeo, truckYellowMat);
      floor.position.set(0, 4.8 - hingeY, 0.6 - hingeZ);
      bedPivot.add(floor);

      // Sloped Left Wall (~18° outward flare)
      const wallGeo = new THREE.BoxGeometry(0.45, 3.2, 11.2);
      const wallL = new THREE.Mesh(wallGeo, truckYellowMat);
      wallL.position.set(-4.1, 6.2 - hingeY, 0.6 - hingeZ);
      wallL.rotation.z = 0.31;
      bedPivot.add(wallL);

      // Sloped Right Wall (~18° outward flare)
      const wallR = new THREE.Mesh(wallGeo, truckYellowMat);
      wallR.position.set( 4.1, 6.2 - hingeY, 0.6 - hingeZ);
      wallR.rotation.z = -0.31;
      bedPivot.add(wallR);

      // Exterior Vertical Reinforcing Ribs (Bolsters)
      const ribGeo = new THREE.BoxGeometry(0.28, 3.1, 0.45);
      const ribMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.6 });
      [-3.8, -1.4, 1.0, 3.4].forEach(rz => {
        const rL = new THREE.Mesh(ribGeo, ribMat);
        rL.position.set(-4.3, 6.2 - hingeY, (0.6 + rz) - hingeZ);
        rL.rotation.z = 0.31;
        bedPivot.add(rL);
        const rR = new THREE.Mesh(ribGeo, ribMat);
        rR.position.set( 4.3, 6.2 - hingeY, (0.6 + rz) - hingeZ);
        rR.rotation.z = -0.31;
        bedPivot.add(rR);
      });

      // Front Bulkhead
      const frontBulkGeo = new THREE.BoxGeometry(8.4, 3.6, 0.5);
      const frontBulk = new THREE.Mesh(frontBulkGeo, truckYellowMat);
      frontBulk.position.set(0, 6.5 - hingeY, 6.2 - hingeZ);
      bedPivot.add(frontBulk);

      // Overhead Protective Rock Canopy (extends forward over cab)
      const canopyGeo = new THREE.BoxGeometry(8.8, 0.45, 4.4);
      const canopyMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.65 });
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.position.set(0, 8.2 - hingeY, 7.8 - hingeZ);
      bedPivot.add(canopy);

      // Rear Ducktail Chute
      const chuteGeo = new THREE.BoxGeometry(8.2, 0.5, 2.0);
      const chute = new THREE.Mesh(chuteGeo, truckYellowMat);
      chute.position.set(0, 5.2 - hingeY, -5.2 - hingeZ);
      chute.rotation.x = -0.30;
      bedPivot.add(chute);

      // Mounded Ore / Coal Payload
      const payloadGeo = new THREE.BoxGeometry(7.2, 2.0, 9.6);
      const payloadMat = new THREE.MeshStandardMaterial({ color: 0x1e1b18, roughness: 0.95, metalness: 0.05 });
      const payload = new THREE.Mesh(payloadGeo, payloadMat);
      payload.position.set(0, 6.0 - hingeY, 0.6 - hingeZ);
      bedPivot.add(payload);
      truck.payloadMesh = payload;

      // Hydraulic Hoist Rams
      const ramGeo = new THREE.CylinderGeometry(0.32, 0.32, 3.4, 12);
      const ramMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.2 });
      const ramL = new THREE.Mesh(ramGeo, ramMat);
      ramL.position.set(-1.8, 4.2 - hingeY, 2.2 - hingeZ);
      bedPivot.add(ramL);
      const ramR = new THREE.Mesh(ramGeo, ramMat);
      ramR.position.set( 1.8, 4.2 - hingeY, 2.2 - hingeZ);
      bedPivot.add(ramR);

      truck.bedPivot = bedPivot;
      truck.add(bedPivot);

      // 5. Subtle Contact Shadow sitting directly underneath tires at local Y = 0.02
      const shadowGeo = new THREE.PlaneGeometry(11.8, 16.5);
      shadowGeo.rotateX(-Math.PI / 2);
      const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.60,
        depthWrite: false
      });
      const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
      shadowMesh.position.y = 0.02;
      truck.add(shadowMesh);

      // 6. Selection Highlight Ground Bracket / Halo (subtle thin industrial perimeter)
      const selRingGeo = new THREE.RingGeometry(6.6, 6.95, 32);
      selRingGeo.rotateX(-Math.PI / 2);
      const selRingMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.50,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const selRing = new THREE.Mesh(selRingGeo, selRingMat);
      selRing.position.y = 0.06;
      selRing.visible = false;
      truck.add(selRing);
      truck.selectionRing = selRing;

      // 7. Radar Safety Ring (Thin 0.35m perimeter outline, subtle opacity)
      const ringGeo = new THREE.RingGeometry(11.0, 11.35, 36);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.08;
      truck.add(ring);
      truck.radarRing = ring;

      // 8. Vertical Leader Line from Truck Roof to Floating Label
      const lineGeo = new THREE.CylinderGeometry(0.08, 0.08, 10.5, 8);
      const lineMat = new THREE.MeshBasicMaterial({
        color: 0xc9a227,
        transparent: true,
        opacity: 0.85,
        depthTest: false
      });
      const leaderLine = new THREE.Mesh(lineGeo, lineMat);
      leaderLine.position.set(0, 14.5, 0);
      leaderLine.renderOrder = 998;
      truck.add(leaderLine);
      truck.leaderLine = leaderLine;

      // 9. High-Resolution Dynamic 3D Floating DMP ID Label Sprite (~1.5x scale)
      const canvas = document.createElement('canvas');
      canvas.width = 440;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      truck.labelCanvas = canvas;
      truck.labelCtx = ctx;

      const texture = new THREE.CanvasTexture(canvas);
      truck.labelTexture = texture;

      const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(0, 20.8, 0);
      sprite.scale.set(19.0, 7.8, 1.0);
      sprite.renderOrder = 999;
      truck.add(sprite);
      truck.labelSprite = sprite;

      // Initial label render
      this.drawTruckLabel(truck, primaryId, secondaryId, 0, 'STOP', false);

      return truck;
    }

    /**
     * Draw professional industrial DMP vehicle identification tag onto canvas.
     */
    drawTruckLabel(truck, primaryId, secondaryId, speedKmh, statusText, isSelected) {
      if (!truck || !truck.labelCanvas || !truck.labelCtx) return;
      const ctx = truck.labelCtx;
      const w = truck.labelCanvas.width;
      const h = truck.labelCanvas.height;

      ctx.clearRect(0, 0, w, h);

      // Dark semi-opaque rounded rectangle container
      const bgColor = isSelected ? 'rgba(12, 22, 36, 0.94)' : 'rgba(10, 14, 22, 0.90)';
      ctx.fillStyle = bgColor;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(6, 6, w - 12, h - 12, 14);
      } else {
        ctx.rect(6, 6, w - 12, h - 12);
      }
      ctx.fill();

      // Border: Cyan if selected, Warm Gold otherwise
      ctx.strokeStyle = isSelected ? 'rgba(56, 189, 248, 0.95)' : 'rgba(201, 162, 39, 0.85)';
      ctx.lineWidth = isSelected ? 4 : 3;
      ctx.stroke();

      // Row 1: Primary ID (e.g. DMP-101)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isSelected ? '#38bdf8' : '#ffffff';
      ctx.font = 'bold 50px "Space Grotesk", sans-serif';
      ctx.fillText(primaryId, w / 2, 20);

      // Row 2: Secondary ID & Model (e.g. TRUCK_01)
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 24px "IBM Plex Mono", monospace';
      ctx.fillText(secondaryId, w / 2, 80);

      // Row 3: Status Indicator Badge
      let dotColor = '#10b981';
      let statStr = `MOVING · ${Math.round(speedKmh)} km/h`;
      if (statusText === 'STOP' || speedKmh < 0.5) {
        dotColor = '#ef4444';
        statStr = 'STOPPED';
      } else if (statusText === 'SLOW DOWN' || speedKmh < 14) {
        dotColor = '#f59e0b';
        statStr = `CAUTION · ${Math.round(speedKmh)} km/h`;
      }

      const badgeY = 126;
      ctx.beginPath();
      ctx.arc(w / 2 - ctx.measureText(statStr).width / 2 - 12, badgeY + 12, 6, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      ctx.fillStyle = dotColor;
      ctx.font = '700 24px "IBM Plex Mono", monospace';
      ctx.fillText(statStr, w / 2 + 6, badgeY);

      if (truck.labelTexture) {
        truck.labelTexture.needsUpdate = true;
      }
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
        const truckMesh = this.createMiningTruck(id, vId, 0xd49b28);
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

      if (scene) {
        this.scene = scene;
        scene.add(this.truckGroup);
      }
      return this.truckGroup;
    }

    /**
     * DYNAMICALLY ADD A NEW DEVICE TO FLEET GROUP
     * Creates new truck mesh without recreating the scene, clearing existing trucks, or resetting camera.
     */
    addTruckToFleet(v) {
      if (!this.truckGroup) return null;
      const vId = v.id;
      if (this.truckObjects[vId]) return this.truckObjects[vId];
      const id = v.dmp_id || v.name || vId;
      let colorHex = 0xd49b28;
      if (v.avatar_color) {
        const parsed = parseInt(String(v.avatar_color).replace('#', '0x'), 16);
        if (!isNaN(parsed)) colorHex = parsed;
      }
      const truckMesh = this.createMiningTruck(id, vId, colorHex);
      truckMesh.name = vId;
      const idx = Object.keys(this.truckObjects).length;
      const item = {
        mesh: truckMesh,
        idText: id,
        idx,
        targetPos: new THREE.Vector3(),
        targetYaw: 0,
        initialized: false,
        backendData: v
      };
      this.truckObjects[vId] = item;
      this.truckGroup.add(truckMesh);
      return item;
    }

    /**
     * UPDATE TRUCK LOCATIONS DIRECTLY FROM AUTHORITATIVE BACKEND TELEMETRY
     * No independent clock, zero independent progression math.
     * Positions strictly follow (v.lat, v.lng, v.elevation_m, v.heading).
     */
    updateFleetTelemetry(fleet) {
      if (!fleet || !Array.isArray(fleet)) return;

      fleet.forEach(v => {
        let item = this.truckObjects[v.id];
        if (!item || !item.mesh) {
          item = this.addTruckToFleet(v);
        }
        if (!item || !item.mesh) return;

        // Out-of-order sequence guard: discard stale packets
        if (v.sequence !== undefined && item.lastSequence !== undefined && v.sequence < item.lastSequence) {
          return;
        }
        if (v.sequence !== undefined) {
          item.lastSequence = v.sequence;
        }

        item.backendData = v;
        item.speedMps = (v.speed_kmh || 0) * (1000 / 3600);
        item.isMoving = (v.is_moving !== false) && (v.action !== 'STOP') && (item.speedMps > 0.1);

        // Authoritative positioning from backend
        const elev = (v.elevation_m !== undefined && v.elevation_m !== null)
          ? v.elevation_m
          : this.sampleCarvedElevation(v.lng, v.lat);
        const targetWorld = this.lonLatToWorld(v.lng, v.lat, elev, this.vscale);

        // Constrain targetWorld strictly to haul-road corridor (Requirement 3)
        const roadInfo = this.getNearestRoadPoint(targetWorld.x, targetWorld.z);
        const maxLaneOffset = roadInfo.isSwitchback ? 4.5 : 3.0;
        if (roadInfo.lateralDist > maxLaneOffset) {
          const excess = roadInfo.lateralDist - maxLaneOffset;
          const pull = excess / roadInfo.lateralDist;
          targetWorld.x += (roadInfo.point.x - targetWorld.x) * pull;
          targetWorld.z += (roadInfo.point.z - targetWorld.z) * pull;
        }

        // Ground truck onto physical haul-road surface (Requirement 2)
        const roadSurfaceY = this.getHaulRoadSurfaceAt(targetWorld.x, targetWorld.z);
        targetWorld.y = roadSurfaceY + 0.02;

        // Authoritative yaw rotation:
        const headingDeg = (v.heading !== undefined && v.heading !== null) ? v.heading : 0;
        const targetYaw = Math.PI - (headingDeg * Math.PI / 180.0);
        item.backendYaw = targetYaw;

        if (!item.initialized) {
          item.mesh.position.set(targetWorld.x, targetWorld.y, targetWorld.z);
          item.mesh.rotation.y = targetYaw;
          item.targetPos.set(targetWorld.x, targetWorld.y, targetWorld.z);
          item.targetYaw = targetYaw;
          item.initialized = true;
        } else {
          // If difference is large (> 45m, e.g. initial load or scenario change), snap immediately
          const distToTarget = Math.hypot(targetWorld.x - item.mesh.position.x, targetWorld.z - item.mesh.position.z);
          if (distToTarget > 45.0) {
            item.mesh.position.set(targetWorld.x, targetWorld.y, targetWorld.z);
            item.mesh.rotation.y = targetYaw;
          }
          item.targetPos.set(targetWorld.x, targetWorld.y, targetWorld.z);
          item.targetYaw = targetYaw;
        }

        // Update 3D floating identification label
        const isSel = (v.id === this.selectedVehicleId);
        this.drawTruckLabel(item.mesh, item.idText, v.id, v.speed_kmh || 0, v.action || (item.isMoving ? 'MOVING' : 'STOP'), isSel);

        // Radar safety ring color based on authoritative risk / action (subtle tone, non-dominating)
        if (item.mesh.radarRing) {
          const riskTotal = (v.risk_score && v.risk_score.total !== undefined) ? v.risk_score.total : 0;
          if (v.action === 'STOP' || riskTotal >= 70 || (v.dist_front !== undefined && v.dist_front < 60)) {
            item.mesh.radarRing.material.color.setHex(0xef4444); // Red collision hazard
            item.mesh.radarRing.material.opacity = 0.35;
          } else if (v.action === 'SLOW DOWN' || riskTotal >= 40 || (v.dist_front !== undefined && v.dist_front < 150)) {
            item.mesh.radarRing.material.color.setHex(0xf59e0b); // Amber caution
            item.mesh.radarRing.material.opacity = 0.25;
          } else {
            item.mesh.radarRing.material.color.setHex(0x10b981); // Green clear
            item.mesh.radarRing.material.opacity = 0.0; // Completely invisible during normal clear driving
          }
        }
        // Record historical travelled trail point
        this.recordVehicleTrail(v.id, item.mesh.position);
      });
    }

    /**
     * FRAME INTERPOLATION (SMOOTHING A -> B BETWEEN 1-SECOND SERVER TICKS)
     * Real-time 4-wheel contact patch sampling, critically damped suspension,
     * longitudinal slope pitching, lateral roll, and road-curvature conforming dead reckoning.
     */
    stepInterpolation(dt = 0.016, camera = null) {
      if (camera) this.activeCamera = camera;

      for (const vId in this.truckObjects) {
        const item = this.truckObjects[vId];
        if (!item || !item.mesh || !item.initialized) continue;

        // 1. Constrained dead reckoning along road curvature between 1-second server polls
        // Eliminates straight-line tangents cutting across curves or off haul-road berms
        if (item.isMoving && item.speedMps > 0.1) {
          const roadInfo = this.getNearestRoadPoint(item.targetPos.x, item.targetPos.z);
          const truckFwdX = -Math.sin(item.targetYaw);
          const truckFwdZ = -Math.cos(item.targetYaw);
          const dot = truckFwdX * roadInfo.tangent.x + truckFwdZ * roadInfo.tangent.z;
          const roadDir = dot >= 0 ? 1.0 : -1.0;

          const moveDist = item.speedMps * dt;
          item.targetPos.x += roadInfo.tangent.x * roadDir * moveDist;
          item.targetPos.z += roadInfo.tangent.z * roadDir * moveDist;

          // Road corridor lateral constraint (Requirement 3)
          // Keep truck strictly within its travel lane (±2-4m from centerline)
          const maxLaneOffset = roadInfo.isSwitchback ? 4.5 : 3.0;
          if (roadInfo.lateralDist > maxLaneOffset) {
            const pullFactor = Math.min(1.0, dt * 8.0);
            item.targetPos.x += (roadInfo.point.x - item.targetPos.x) * pullFactor;
            item.targetPos.z += (roadInfo.point.z - item.targetPos.z) * pullFactor;
          } else if (roadInfo.lateralDist > 1.0) {
            const pullFactor = Math.min(0.25, dt * 2.5);
            item.targetPos.x += (roadInfo.point.x - item.targetPos.x) * pullFactor;
            item.targetPos.z += (roadInfo.point.z - item.targetPos.z) * pullFactor;
          }

          // Road curvature steering alignment along road tangent
          const backendYaw = (item.backendYaw !== undefined) ? item.backendYaw : item.targetYaw;
          const targetRoadYaw = Math.atan2(-roadInfo.tangent.x * roadDir, -roadInfo.tangent.z * roadDir);
          let roadYawDiff = targetRoadYaw - backendYaw;
          while (roadYawDiff < -Math.PI) roadYawDiff += Math.PI * 2;
          while (roadYawDiff > Math.PI) roadYawDiff -= Math.PI * 2;
          const clampedOffset = Math.max(-0.15, Math.min(0.15, roadYawDiff));
          item.targetYaw = backendYaw + clampedOffset;
        }

        // Smooth horizontal movement towards targetPos
        const alpha = Math.min(1.0, dt * 6.0);
        item.mesh.position.x += (item.targetPos.x - item.mesh.position.x) * alpha;
        item.mesh.position.z += (item.targetPos.z - item.mesh.position.z) * alpha;

        // Hard corridor clamp on mesh position (Requirement 3)
        const curRoadInfo = this.getNearestRoadPoint(item.mesh.position.x, item.mesh.position.z);
        const maxMeshDist = curRoadInfo.isSwitchback ? 5.2 : 3.6;
        if (curRoadInfo.lateralDist > maxMeshDist) {
          const excess = curRoadInfo.lateralDist - maxMeshDist;
          const pull = excess / curRoadInfo.lateralDist;
          item.mesh.position.x += (curRoadInfo.point.x - item.mesh.position.x) * pull;
          item.mesh.position.z += (curRoadInfo.point.z - item.mesh.position.z) * pull;
        }

        const posX = item.mesh.position.x;
        const posZ = item.mesh.position.z;

        // Smooth yaw rotation
        let dyaw = item.targetYaw - item.mesh.rotation.y;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        item.mesh.rotation.y += dyaw * Math.min(1.0, dt * 5.0);

        // Heading unit vectors
        const curYaw = item.mesh.rotation.y;
        const fwdX = -Math.sin(curYaw);
        const fwdZ = -Math.cos(curYaw);
        const rightX = Math.cos(curYaw);
        const rightZ = -Math.sin(curYaw);

        // 4-Wheel Contact Patch Road Sampling (Requirement 4):
        // Half-wheelbase = 4.5m, half-track = 4.2m
        const Lhalf = 4.5;
        const Whalf = 4.2;

        const flX = posX + fwdX * Lhalf - rightX * Whalf;
        const flZ = posZ + fwdZ * Lhalf - rightZ * Whalf;
        const frX = posX + fwdX * Lhalf + rightX * Whalf;
        const frZ = posZ + fwdZ * Lhalf + rightX * Whalf;
        const rlX = posX - fwdX * Lhalf - rightX * Whalf;
        const rlZ = posZ - fwdZ * Lhalf - rightZ * Whalf;
        const rrX = posX - fwdX * Lhalf + rightX * Whalf;
        const rrZ = posZ - fwdZ * Lhalf + rightZ * Whalf;

        // Exact haul-road surface heights at contact points
        const hFL = this.getHaulRoadSurfaceAt(flX, flZ);
        const hFR = this.getHaulRoadSurfaceAt(frX, frZ);
        const hRL = this.getHaulRoadSurfaceAt(rlX, rlZ);
        const hRR = this.getHaulRoadSurfaceAt(rrX, rrZ);

        // Truck elevation = average of 4 wheel contact points + contact tolerance (Requirement 4)
        const targetY = (hFL + hFR + hRL + hRR) * 0.25 + 0.02;

        // Critically damped vertical suspension smoothing
        item.mesh.position.y += (targetY - item.mesh.position.y) * Math.min(1.0, dt * 10.0);

        // Longitudinal pitch along slope (uphill: nose up -> negative rotation.x)
        const wheelbase = Lhalf * 2.0;
        const hFront = (hFL + hFR) * 0.5;
        const hRear = (hRL + hRR) * 0.5;
        const slopePitch = -Math.atan2(hFront - hRear, wheelbase);
        const clampedPitch = Math.max(-0.45, Math.min(0.45, slopePitch));
        item.mesh.rotation.x += (clampedPitch - item.mesh.rotation.x) * Math.min(1.0, dt * 8.0);

        // Lateral roll across slope/camber (banking right -> negative rotation.z)
        const trackWidth = Whalf * 2.0;
        const hLeft = (hFL + hRL) * 0.5;
        const hRight = (hFR + hRR) * 0.5;
        const slopeRoll = -Math.atan2(hRight - hLeft, trackWidth);
        const clampedRoll = Math.max(-0.20, Math.min(0.20, slopeRoll));
        item.mesh.rotation.z += (clampedRoll - item.mesh.rotation.z) * Math.min(1.0, dt * 8.0);

        // Distance-Adaptive Scaling for 3D Floating Labels (~1.5x scale, camera-facing, readable)
        if (item.mesh.labelSprite && this.activeCamera) {
          const camDist = this.activeCamera.position.distanceTo(item.mesh.position);
          const scaleFactor = Math.max(0.85, Math.min(2.5, camDist / 500.0));
          item.mesh.labelSprite.scale.set(19.0 * scaleFactor, 7.8 * scaleFactor, 1.0);
          item.mesh.labelSprite.position.y = 20.8 + (scaleFactor - 1.0) * 5.0;
        }

        // Dump bed animation at stockpile yard
        if (item.mesh.bedPivot) {
          const bData = item.backendData;
          const isDumping = bData && (bData.lifecycle_state === 'UNLOADING' || bData.lifecycle_state === 'DUMPING');
          const targetBedAngle = isDumping ? -0.585 : 0.0;
          const bedSpeed = isDumping ? 1.8 : 2.2;
          item.mesh.bedPivot.rotation.x += (targetBedAngle - item.mesh.bedPivot.rotation.x) * Math.min(1.0, dt * bedSpeed);

          if (item.mesh.payloadMesh) {
            const hasPayload = bData && bData.payload_tons !== undefined ? (bData.payload_tons > 1.0) : true;
            item.mesh.payloadMesh.visible = hasPayload && (item.mesh.bedPivot.rotation.x > -0.22);
          }
        }

        // 5. Temporary Road Tracking Debug Visualizer (Requirement 5)
        const isDebugActive = this.showRoadDebug || (typeof window !== 'undefined' && !!window.DEBUG_ROAD_TRACKING);
        if (isDebugActive) {
          if (!this.roadDebugGroup || !this.roadDebugGroup.parent) {
            this.setRoadDebugVisible(this.scene || (item.mesh && item.mesh.parent ? item.mesh.parent : null), true);
          }
          if (item.debugMarkers) {
            const clearance = (this.roadClearance !== undefined) ? this.roadClearance : (0.58 * Math.max(1.0, this.vscale));
            const roadCenterY = curRoadInfo.point.y + clearance;
            const truckContactY = item.mesh.position.y;

            // Green dot at nearest road centerline point
            item.debugMarkers.roadPt.position.set(curRoadInfo.point.x, roadCenterY + 0.15, curRoadInfo.point.z);
            // Red dot at truck contact point
            item.debugMarkers.mid.position.set(posX, truckContactY, posZ);
            // Yellow line connecting them
            item.debugMarkers.offsetLine.geometry.setFromPoints([
              new THREE.Vector3(curRoadInfo.point.x, roadCenterY + 0.15, curRoadInfo.point.z),
              new THREE.Vector3(posX, truckContactY, posZ)
            ]);

            // Wheel contact dots
            item.debugMarkers.fl.position.set(flX, hFL + 0.15, flZ);
            item.debugMarkers.fr.position.set(frX, hFR + 0.15, frZ);
            item.debugMarkers.rl.position.set(rlX, hRL + 0.15, rlZ);
            item.debugMarkers.rr.position.set(rrX, hRR + 0.15, rrZ);

            // Display distance between truck and road centerline:
            // "TRUCK_03 Road Offset: X.X m, Elev Diff: Y.Y m"
            const roadOffset = curRoadInfo.lateralDist.toFixed(1);
            const elevDiff = Math.abs(truckContactY - roadCenterY).toFixed(1);
            const debugStats = `${item.idText || vId} Road Offset: ${roadOffset} m, Elev Diff: ${elevDiff} m`;
            item.roadDebugStats = debugStats;

            if (vId === 'TRUCK_03' || item.idText === 'TRUCK_03') {
              if (typeof window !== 'undefined') {
                window.DEBUG_ROAD_STATS_TRUCK_03 = debugStats;
                let hudEl = document.getElementById('debug-road-tracking-hud');
                if (!hudEl) {
                  hudEl = document.createElement('div');
                  hudEl.id = 'debug-road-tracking-hud';
                  hudEl.style.position = 'fixed';
                  hudEl.style.bottom = '48px';
                  hudEl.style.left = '50%';
                  hudEl.style.transform = 'translateX(-50%)';
                  hudEl.style.background = 'rgba(10, 15, 26, 0.92)';
                  hudEl.style.border = '1px solid #10b981';
                  hudEl.style.color = '#38bdf8';
                  hudEl.style.padding = '8px 18px';
                  hudEl.style.borderRadius = '5px';
                  hudEl.style.fontFamily = "'IBM Plex Mono', monospace";
                  hudEl.style.fontSize = '12px';
                  hudEl.style.fontWeight = 'bold';
                  hudEl.style.zIndex = '9999';
                  hudEl.style.pointerEvents = 'none';
                  hudEl.style.boxShadow = '0 4px 16px rgba(0,0,0,0.6)';
                  hudEl.style.letterSpacing = '0.04em';
                  document.body.appendChild(hudEl);
                }
                hudEl.textContent = `◈ ${debugStats}`;
                hudEl.style.display = 'block';
              }
            }
          }
        } else {
          if (this.roadDebugGroup && this.roadDebugGroup.visible) {
            this.roadDebugGroup.visible = false;
          }
          if (typeof window !== 'undefined') {
            const hudEl = document.getElementById('debug-road-tracking-hud');
            if (hudEl) hudEl.style.display = 'none';
          }
        }
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
      const surfaceElev = this.sampleCarvedElevation(geo.lon, geo.lat);
      let headingDeg = (Math.PI - item.mesh.rotation.y) * 180.0 / Math.PI;
      headingDeg = (headingDeg % 360 + 360) % 360;
      return {
        id: vId,
        lat: geo.lat,
        lng: geo.lon,
        elevation_m: surfaceElev,
        surface_elevation_m: surfaceElev,
        heading: headingDeg,
        backend: item.backendData || null
      };
    }

    /**
     * Focus 3D camera / orbit controls on a vehicle without jarring camera jump
     */
    focusVehicle(vId, controls) {
      const item = this.truckObjects[vId];
      if (!item || !item.mesh) return;
      const p = item.mesh.position;
      if (controls && controls.target) {
        // Truck centroid is around Y+3.8 (truck is 7.6m tall)
        controls.target.set(p.x, p.y + 3.8, p.z);
      }
    }

    /**
     * Set up raycasting click, double-click, and cursor-directed wheel zoom interaction
     */
    setupInteraction(camera, domElement, onSelectVehicle, controls = null) {
      if (!camera || !domElement) return;
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      const getNDC = (event) => {
        const rect = domElement.getBoundingClientRect();
        return {
          x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
          y: -((event.clientY - rect.top) / rect.height) * 2 + 1
        };
      };

      domElement.addEventListener('click', (event) => {
        const m = getNDC(event);
        mouse.x = m.x;
        mouse.y = m.y;

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

      // Double-click to center OrbitControls target on any point of interest (truck, haul road, or terrain)
      domElement.addEventListener('dblclick', (event) => {
        const m = getNDC(event);
        mouse.x = m.x;
        mouse.y = m.y;
        raycaster.setFromCamera(mouse, camera);

        // 1. Check if clicked a truck
        if (this.truckGroup) {
          const truckHits = raycaster.intersectObjects(this.truckGroup.children, true);
          if (truckHits.length > 0) {
            let obj = truckHits[0].object;
            while (obj && obj.parent && obj.parent !== this.truckGroup) {
              obj = obj.parent;
            }
            if (obj) {
              for (const [vId, entry] of Object.entries(this.truckObjects)) {
                if (entry.mesh === obj || entry.idText === obj.name || vId === obj.name) {
                  if (typeof onSelectVehicle === 'function') {
                    onSelectVehicle(vId);
                  }
                  if (controls) {
                    this.focusVehicle(vId, controls);
                  }
                  return;
                }
              }
            }
          }
        }

        // 2. Check if clicked road or terrain
        const targets = [];
        if (this.roadBaseMesh) targets.push(this.roadBaseMesh);
        if (this.terrainMesh) targets.push(this.terrainMesh);
        if (targets.length > 0 && controls && controls.target) {
          const hits = raycaster.intersectObjects(targets, false);
          if (hits.length > 0) {
            const pt = hits[0].point;
            controls.target.set(pt.x, pt.y, pt.z);
            controls.update();
          }
        }
      });

      // Configure touch-action so the canvas handles touch gestures cleanly without browser page scrolling
      domElement.style.touchAction = 'none';

      // Distinguish Touchpad 2-Finger Pan vs Mouse Wheel Zoom vs Touchpad Pinch Zoom
      domElement.addEventListener('wheel', (event) => {
        if (!controls || !controls.enabled) return;

        // Prevent the entire dashboard/webpage from scrolling when cursor is over the 3D viewport
        event.preventDefault();

        const isPinch = event.ctrlKey;
        const isTouchpadPan = !isPinch && (
          Math.abs(event.deltaX) > 0.05 ||
          (!Number.isInteger(event.deltaY) && Math.abs(event.deltaY) < 40)
        );

        if (isTouchpadPan) {
          // Touchpad 2-Finger Drag -> PAN CAMERA (moves target & camera in screen-space)
          const targetDist = camera.position.distanceTo(controls.target);
          const panSpeed = Math.max(0.12, targetDist * 0.0009);

          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

          const panOffset = new THREE.Vector3()
            .addScaledVector(right, event.deltaX * panSpeed)
            .addScaledVector(up, -event.deltaY * panSpeed);

          controls.target.add(panOffset);
          camera.position.add(panOffset);
          controls.update();
        } else {
          // Physical Mouse Wheel OR Touchpad Pinch -> ZOOM CAMERA (with cursor-directed focus)
          const m = getNDC(event);
          mouse.x = m.x;
          mouse.y = m.y;
          raycaster.setFromCamera(mouse, camera);

          const targets = [];
          if (this.truckGroup) targets.push(...this.truckGroup.children);
          if (this.roadBaseMesh) targets.push(this.roadBaseMesh);
          if (this.terrainMesh) targets.push(this.terrainMesh);

          if (targets.length > 0) {
            const hits = raycaster.intersectObjects(targets, true);
            if (hits.length > 0) {
              const hitPoint = hits[0].point;
              // When zooming in (wheel forward / deltaY < 0), gently lerp controls.target towards cursor hit point
              if (event.deltaY < 0) {
                controls.target.lerp(hitPoint, 0.15);
              }
            } else if (this.selectedVehicleId && this.truckObjects[this.selectedVehicleId]) {
              const trk = this.truckObjects[this.selectedVehicleId];
              if (trk && trk.mesh && event.deltaY < 0) {
                const tp = trk.mesh.position;
                controls.target.lerp(new THREE.Vector3(tp.x, tp.y + 3.8, tp.z), 0.10);
              }
            }
          }
        }
      }, { passive: false });
    }

    /**
     * BUILD TERRAIN-AWARE HAZARD ZONES & FOG INVERSION DISC
     */
    buildHazardZones(scene, vscale = 1.5) {
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
    buildLandmarks(scene, vscale = 1.5) {
      if (this.landmarkGroup && scene) {
        scene.remove(this.landmarkGroup);
      }
      this.landmarkGroup = new THREE.Group();
      this.landmarkGroup.name = 'BailadilaLandmarks';

      const OPERATIONAL_LABELS = [
        {
          name: 'MINE PIT',
          sub: 'Deposit-14 Pit Floor (~519m ASL)',
          lon: 81.2194, lat: 18.5792,
          color: '#ef4444',
          colorHex: 0xef4444,
          isPit: true,
          lift: 55
        },
        {
          name: 'HAUL ROAD',
          sub: 'Deposit-14 Haul Corridor',
          lon: 81.2255, lat: 18.5862,
          color: '#38bdf8',
          colorHex: 0x38bdf8,
          isPit: true,
          lift: 50
        },
        {
          name: 'DEPOSITION AREA',
          sub: 'Stockpile Yard & CHP Hopper',
          lon: 81.2215, lat: 18.5928,
          color: '#f59e0b',
          colorHex: 0xf59e0b,
          isPit: false,
          lift: 60
        },
        {
          name: 'ORE ZONE',
          sub: 'High-Grade Hematite Seam',
          lon: 81.2248, lat: 18.5818,
          color: '#fb923c',
          colorHex: 0xfb923c,
          isPit: true,
          lift: 52
        },
        {
          name: 'ZONE 2 — EAST HAIRPIN',
          sub: 'Switchback 1 (11 km/h)',
          lon: 81.2264, lat: 18.5876,
          color: '#f59e0b',
          colorHex: 0xf59e0b,
          isPit: true,
          lift: 48
        },
        {
          name: 'ZONE 2 — WEST HAIRPIN',
          sub: 'Switchback 2 (11 km/h)',
          lon: 81.2148, lat: 18.5840,
          color: '#f59e0b',
          colorHex: 0xf59e0b,
          isPit: true,
          lift: 48
        }
      ];

      OPERATIONAL_LABELS.forEach(lm => {
        const h = lm.isPit ? this.sampleCarvedElevation(lm.lon, lm.lat) : this.sampleRawElevation(lm.lon, lm.lat);
        const pos = this.lonLatToWorld(lm.lon, lm.lat, h, vscale);

        // Slim vertical needle anchor
        const needleGeo = new THREE.CylinderGeometry(0.6, 0.6, lm.lift, 8);
        const needleMat = new THREE.MeshBasicMaterial({ color: lm.colorHex, transparent: true, opacity: 0.65 });
        const needle = new THREE.Mesh(needleGeo, needleMat);
        needle.position.set(pos.x, pos.y + lm.lift * 0.5, pos.z);
        this.landmarkGroup.add(needle);

        // Subtle 3D Pill Badge
        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');

        // Dark glass background
        ctx.fillStyle = 'rgba(10, 15, 26, 0.88)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(4, 4, 352, 88, 12);
        } else {
          ctx.rect(4, 4, 352, 88);
        }
        ctx.fill();

        ctx.strokeStyle = lm.color;
        ctx.lineWidth = 3;
        ctx.stroke();

        // Accent top bar
        ctx.fillStyle = lm.color;
        ctx.fillRect(16, 8, 50, 4);

        // Title
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 24px "Space Grotesk", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(lm.name, 16, 42);

        // Subtitle
        ctx.fillStyle = lm.color;
        ctx.font = '600 13px "JetBrains Mono", monospace';
        ctx.fillText(lm.sub, 16, 68);

        const tex = new THREE.CanvasTexture(canvas);
        const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(sm);
        sprite.position.set(pos.x, pos.y + lm.lift + 16, pos.z);
        sprite.scale.set(110, 29, 1);
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
      if (this.stockpileGroup) this.stockpileGroup.visible = this.showRoads;
    }

    setTrucksVisible(visible) {
      this.showTrucks = !!visible;
      if (this.truckGroup) this.truckGroup.visible = this.showTrucks;
    }

    /**
     * UPDATE WORLD OBSTACLES DIRECTLY FROM AUTHORITATIVE BACKEND TELEMETRY
     * Renders physical 3D boulders on the DEM terrain and removes them when expired.
     */
    updateObstacles(obstacles) {
      const scene = this.scene || (this.truckGroup ? this.truckGroup.parent : null);
      if (!scene) return;

      if (!this.obstacleGroup) {
        this.obstacleGroup = new THREE.Group();
        this.obstacleGroup.name = 'BailadilaWorldObstacles';
        scene.add(this.obstacleGroup);
      } else if (!this.obstacleGroup.parent) {
        scene.add(this.obstacleGroup);
      }

      const activeIds = new Set();
      const list = Array.isArray(obstacles) ? obstacles : [];

      list.forEach(obs => {
        if (!obs || !obs.id) return;
        activeIds.add(obs.id);
        let item = this.obstacleObjects[obs.id];

        const elev = (obs.elevation_m !== undefined && obs.elevation_m !== null)
          ? obs.elevation_m
          : this.sampleCarvedElevation(obs.lng, obs.lat);
        const worldPos = this.lonLatToWorld(obs.lng, obs.lat, elev, this.vscale);

        if (!item) {
          const boulderGroup = new THREE.Group();
          boulderGroup.name = `Obstacle_${obs.id}`;

          // Realistic blasted iron-ore boulder mesh (faceted, rugged hematite)
          const rockGeo = new THREE.DodecahedronGeometry(3.2, 1);
          const posAttr = rockGeo.attributes.position;
          for (let i = 0; i < posAttr.count; i++) {
            const vx = posAttr.getX(i);
            const vy = posAttr.getY(i);
            const vz = posAttr.getZ(i);
            const noise = 0.82 + Math.sin(vx * 2.8 + vy * 1.9) * 0.28;
            posAttr.setXYZ(i, vx * noise, vy * noise * 0.85, vz * noise);
          }
          rockGeo.computeVertexNormals();

          const rockMat = new THREE.MeshStandardMaterial({
            color: 0x662d22, // Rich dark ironstone/hematite
            roughness: 0.92,
            metalness: 0.18,
            flatShading: true
          });
          const rockMesh = new THREE.Mesh(rockGeo, rockMat);
          rockMesh.position.y = 2.0;
          rockMesh.castShadow = true;
          rockMesh.receiveShadow = true;
          boulderGroup.add(rockMesh);

          // Glowing red hazard boundary ring on ground
          const ringGeo = new THREE.RingGeometry(3.6, 4.2, 32);
          ringGeo.rotateX(-Math.PI / 2);
          const ringMat = new THREE.MeshBasicMaterial({
            color: 0xef4444,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85
          });
          const ringMesh = new THREE.Mesh(ringGeo, ringMat);
          ringMesh.position.y = 0.2;
          boulderGroup.add(ringMesh);

          // Glowing beacon light
          const beaconLight = new THREE.PointLight(0xef4444, 2.2, 35);
          beaconLight.position.set(0, 3.5, 0);
          boulderGroup.add(beaconLight);

          boulderGroup.position.set(worldPos.x, worldPos.y, worldPos.z);
          this.obstacleGroup.add(boulderGroup);

          this.obstacleObjects[obs.id] = {
            group: boulderGroup,
            rockMesh: rockMesh,
            ringMesh: ringMesh,
            light: beaconLight,
            data: obs
          };
        } else {
          item.group.position.set(worldPos.x, worldPos.y, worldPos.z);
          item.data = obs;
        }
      });

      // Remove expired obstacles cleanly
      Object.keys(this.obstacleObjects).forEach(id => {
        if (!activeIds.has(id)) {
          const item = this.obstacleObjects[id];
          if (item && item.group) {
            this.obstacleGroup.remove(item.group);
            if (item.rockMesh && item.rockMesh.geometry) item.rockMesh.geometry.dispose();
            if (item.rockMesh && item.rockMesh.material) item.rockMesh.material.dispose();
            if (item.ringMesh && item.ringMesh.geometry) item.ringMesh.geometry.dispose();
            if (item.ringMesh && item.ringMesh.material) item.ringMesh.material.dispose();
          }
          delete this.obstacleObjects[id];
        }
      });
    }

    setHazardsVisible(visible) {
      this.showHazards = !!visible;
      if (this.hazardGroup) this.hazardGroup.visible = this.showHazards;
      if (this.obstacleGroup) this.obstacleGroup.visible = this.showHazards;
    }

    setVerticalScale(scene, vscale) {
      this.vscale = vscale;
      this.roadClearance = 0.58 * Math.max(1.0, vscale);
      this.buildTerrain(scene, vscale);
      this.buildHaulRoads(scene, vscale);
      this.buildHazardZones(scene, vscale);
      this.buildLandmarks(scene, vscale);
      this.buildStockpileYard(scene, vscale);
    }

    /**
     * Optional 3D Haul Road & Vehicle Physics Debug Visualization (Requirement 17)
     * Shows haul-road centerline, 4-wheel contact patches, nearest road station,
     * and lateral offset vectors.
     */
    setRoadDebugVisible(scene, visible) {
      this.showRoadDebug = !!visible;
      if (typeof window !== 'undefined') {
        window.DEBUG_ROAD_TRACKING = this.showRoadDebug;
      }
      if (!this.roadDebugGroup) {
        this.roadDebugGroup = new THREE.Group();
        this.roadDebugGroup.name = 'BailadilaRoadDebugGroup';

        // 1. Haul Road Centerline Ribbon
        if (this.sampledRoad && this.sampledRoad.length) {
          const clr = (this.roadClearance !== undefined) ? this.roadClearance : 0.87;
          const pts = this.sampledRoad.map(p => new THREE.Vector3(p.x, p.y + clr, p.z));
          pts.push(new THREE.Vector3(this.sampledRoad[0].x, this.sampledRoad[0].y + clr, this.sampledRoad[0].z));
          const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
          const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
          const line = new THREE.Line(lineGeo, lineMat);
          this.roadDebugGroup.add(line);
        }

        // 2. Contact markers for each truck (Requirement 5)
        const sphereGeoMinor = new THREE.SphereGeometry(0.75, 12, 12);
        const sphereGeoMajor = new THREE.SphereGeometry(1.5, 16, 16);
        const matContact = new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false });
        // Green dot at nearest road centerline point (Requirement 5)
        const matRoadPt = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false });
        // Red dot at truck contact point (Requirement 5)
        const matMid = new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false });
        // Yellow line connecting them (Requirement 5)
        const offLineMat = new THREE.LineBasicMaterial({ color: 0xfacc15, linewidth: 4, depthTest: false });

        for (const vId in this.truckObjects) {
          const item = this.truckObjects[vId];
          if (!item) continue;
          const fl = new THREE.Mesh(sphereGeoMinor, matContact);
          const fr = new THREE.Mesh(sphereGeoMinor, matContact);
          const rl = new THREE.Mesh(sphereGeoMinor, matContact);
          const rr = new THREE.Mesh(sphereGeoMinor, matContact);
          const mid = new THREE.Mesh(sphereGeoMajor, matMid);
          const roadPt = new THREE.Mesh(sphereGeoMajor, matRoadPt);
          mid.renderOrder = 999;
          roadPt.renderOrder = 999;

          const offLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
          const offLine = new THREE.Line(offLineGeo, offLineMat);
          offLine.renderOrder = 998;

          this.roadDebugGroup.add(fl);
          this.roadDebugGroup.add(fr);
          this.roadDebugGroup.add(rl);
          this.roadDebugGroup.add(rr);
          this.roadDebugGroup.add(mid);
          this.roadDebugGroup.add(roadPt);
          this.roadDebugGroup.add(offLine);

          item.debugMarkers = { fl, fr, rl, rr, mid, roadPt, offsetLine: offLine };
        }
      }

      this.roadDebugGroup.visible = this.showRoadDebug;
      const targetScene = scene || this.scene;
      if (targetScene) {
        if (this.showRoadDebug && !this.roadDebugGroup.parent) {
          targetScene.add(this.roadDebugGroup);
        }
      }
    }

    /**
     * Panoramic camera starting position (Requirement 4):
     * Directly frames the active Deposit-14 haul circuit, pit benches, and all 6 haul trucks.
     * Distance ~865m ensures trucks and their large 3D DMP labels are immediately visible on page load.
     */
    getRecommendedCameraOverview() {
      const pC = this.pitPos;
      return {
        position: new THREE.Vector3(pC.x + 640, 1050, pC.z - 170),
        target: new THREE.Vector3(pC.x + 120, 630, pC.z - 720)
      };
    }
  }

  // Export to global scope
  global.BailadilaTerrainEngine = BailadilaTerrainEngine;
  global.bailadilaEngine = new BailadilaTerrainEngine();

})(typeof window !== 'undefined' ? window : this);
