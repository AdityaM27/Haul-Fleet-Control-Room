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
      this.terrainGridHeights = null; // Exact Float32Array grid of rendered surface heights
      this.pitExcavationMesh = null;
      this.roadGroup = null;
      this.stockpileGroup = null;
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
      if (!this.terrainGridHeights || this.terrainGridHeights.length !== W * H) {
        this.terrainGridHeights = new Float32Array(W * H);
      }
      const geo = new THREE.BufferGeometry();

      const positions = [];
      const colors = [];
      const indices = [];

      // Realistic Open-Cast Iron Ore Mining Color Hierarchy
      const cLowPlain   = new THREE.Color(0x867764);   // Natural alluvial valley floor (muted dusty brown/tan)
      const cMidScrub   = new THREE.Color(0x978673);   // Natural Bastar hillside scrub (warm dusty tan)
      const cRidgeIron  = new THREE.Color(0xa89785);   // Mountain ridge slopes (weathered ironstone tan)
      const cPeakSlate  = new THREE.Color(0x726a5e);   // High quartzite mountain peaks
      const cBenchFloor = new THREE.Color(0x4a3f37);   // Active terraced working bench floor (dark quarry dust)
      const cRockFace   = new THREE.Color(0x2a231e);   // Steep excavated rock face / quarry wall (dark gray/brown)
      const cHematite   = new THREE.Color(0x822919);   // High-grade red hematite iron ore seams (subtle reddish/brown)
      const cIronbloom  = new THREE.Color(0xa13c23);   // Oxidized ironbloom bench terrace (rich rust-red ore)
      const cPitFloor   = new THREE.Color(0x361e14);   // Deep loading bay pit floor (rich ore slurry)
      const cDepotDark  = new THREE.Color(0x241d18);   // Deposition center coal fines & dark spoil
      const cDepotRust  = new THREE.Color(0x523620);   // Deposition center oxidized waste rock

      const minE = this.meta.minElevationMeters;
      const maxE = this.meta.maxElevationMeters;
      const eSpan = maxE - minE;

      // Deposition Center coordinate for surface material staining
      const yardGeoPos = this.lonLatToWorld(81.2215, 18.5928, 0);

      for (let j = 0; j < H; j++) {
        const lat = this.meta.north - (j / (H - 1)) * (this.meta.north - this.meta.south);
        for (let i = 0; i < W; i++) {
          const lon = this.meta.west + (i / (W - 1)) * (this.meta.east - this.meta.west);
          const rawH = this.sampleRawElevation(lon, lat);
          const finalH = this.sampleCarvedElevation(lon, lat);
          this.terrainGridHeights[j * W + i] = finalH;
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

          // Deposition Center footprint calculation
          const distToYard = Math.hypot(worldPos.x - yardGeoPos.x, worldPos.z - yardGeoPos.z);
          const inDepotZone = distToYard < 150.0;

          const col = new THREE.Color();
          if (isInsidePit) {
            // Distinct Open-Cast Pit Terraces & Exposed Ore Hierarchy
            if (uDist < 0.16) {
              col.copy(cPitFloor); // Pit bottom loading floor
            } else {
              const benchVal = (0.88 - uDist) / 0.72 * this.pitBenches;
              const frac = benchVal - Math.floor(benchVal);
              if (frac < 0.72) {
                // Working bench floor with rich hematite and ironbloom mineral veins
                const oreVein = Math.sin(benchVal * 3.14159) * 0.40;
                col.copy(cBenchFloor).lerp(cIronbloom, Math.max(0, oreVein));
              } else {
                // Steep rock face quarry cut: dark rock face interspersed with deep hematite seams
                const faceMix = Math.sin(worldPos.x * 0.03 + worldPos.z * 0.03) * 0.5 + 0.5;
                col.copy(cRockFace).lerp(cHematite, faceMix * 0.85);
              }
            }
            // Subtle mineral grain variation
            const speck = (Math.sin(worldPos.x * 0.06 + worldPos.z * 0.06) * 0.5) * 0.04;
            col.offsetHSL(0, 0, speck);
          } else if (inDepotZone) {
            // Deposition Center / Stockpile Yard: distinct dark & orange-brown spoil zone
            const depotBlend = 1.0 - Math.min(1.0, distToYard / 150.0);
            col.copy(cDepotDark).lerp(cDepotRust, depotBlend * 0.6);
          } else {
            // Natural Surrounding Terrain: muted dusty brown / tan landscape
            if (elevNorm < 0.30) {
              col.copy(cLowPlain).lerp(cMidScrub, elevNorm / 0.30);
            } else if (elevNorm < 0.70) {
              const q = (elevNorm - 0.30) / 0.40;
              col.copy(cMidScrub).lerp(cRidgeIron, q);
            } else {
              const q = (elevNorm - 0.70) / 0.30;
              col.copy(cRidgeIron).lerp(cPeakSlate, q);
            }
            // Gentle natural rock variation
            const grain = (Math.sin(worldPos.x * 0.02) * Math.cos(worldPos.z * 0.02)) * 0.025;
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
      // Standard dual-lane haul road: 26m wide (13m half-width).
      // Hairpin switchbacks: expanded to 34m wide (17m half-width) for authentic heavy truck turning pads.
      const basePositions = [];
      const baseColors = [];
      const baseIndices = [];

      // Open-Cast Mining Haul Road Color Palette:
      // Outer shoulders: dusty quarry berm gravel (#574a3e)
      // Road verges: crushed rock edge (#3b322a)
      // Travel lanes: dark heavy-rolled compacted haul earth (#221c18)
      // Center crown: weathered dark haul surface (#181411)
      const cShoulder = new THREE.Color(0x574a3e);
      const cVerge = new THREE.Color(0x3b322a);
      const cLane = new THREE.Color(0x221c18);
      const cCenter = new THREE.Color(0x181411);

      const colColors = [cShoulder, cVerge, cLane, cCenter, cLane, cVerge, cShoulder];
      const normOffsets = [-1.0, -0.72, -0.36, 0.0, 0.36, 0.72, 1.0];
      const crowns = [0.00, 0.03, 0.06, 0.08, 0.06, 0.03, 0.00];

      for (let i = 0; i < numStations; i++) {
        const p = stations[i];
        const norm = this.sampledNormals[i];
        const halfW = stationIsSwitchback[i] ? 17.0 : 13.0;

        for (let c = 0; c < 7; c++) {
          const vx = p.x + norm.x * (normOffsets[c] * halfW);
          const vz = p.z + norm.z * (normOffsets[c] * halfW);
          // Sample exact rendered facet terrain elevation at each individual vertex
          const facetH = this.getRenderedTerrainHeight(vx, vz);
          const elev = (facetH - this.yMin) * vscale;
          // Offset above terrain scaled with vscale to eliminate facet clipping
          const clearance = 0.55 * Math.max(1.0, vscale);
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
      const bermMat = new THREE.MeshStandardMaterial({ color: 0x42382e, roughness: 0.96 });
      const bermGeo = new THREE.BoxGeometry(2.4, 2.0, 3.8);
      for (let s = 3; s < numStations; s += 8) {
        const p = stations[s];
        const norm = this.sampledNormals[s];
        const halfW = stationIsSwitchback[s] ? 17.0 : 13.0;
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
     * Visual scale: approximately 8-10x the footprint of an ultra-class mining truck (150m x 115m).
     * Includes:
     * - Broad irregular multi-tier dumping apron with safety wheel stops & guide berms
     * - Massive primary raw coal stockpile ridge (76m long, 22m high)
     * - High-grade hematite iron ore conical stockpile (64m diameter, 18m high)
     * - Blended sinter feed ore mound & active ROM spoil bank finger
     * - Coal Handling Plant (CHP) dual-bay dump pocket hopper with grizzly screen grating
     * - Dual elevated conveyor gantries heading towards the processing & rail complex
     * - Four 18m high-mast floodlight towers & perimeter warning beacons
     * - Floating high-contrast 3D billboard marker: "DEPOSITION CENTER — STOCKPILE YARD & CHP HOPPER"
     */
    buildStockpileYard(scene, vscale = 1.0) {
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

      // 1. Broad Irregular Multi-Tiered Dumping Apron Pad (150m x 115m extent)
      const padGeo = new THREE.CylinderGeometry(74, 82, 1.4 * Math.max(0.8, vscale), 36);
      const padMat = new THREE.MeshStandardMaterial({
        color: 0x241e18,
        roughness: 0.95,
        metalness: 0.05
      });
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.scale.set(1.22, 1.0, 0.94); // Irregular broad footprint
      pad.position.set(yardCenter.x, groundY + 0.45 * vscale, yardCenter.z);
      pad.receiveShadow = true;
      this.stockpileGroup.add(pad);

      // Elevated Dumping Spoil Terrace (Raised working bench where trucks discharge)
      const terraceGeo = new THREE.BoxGeometry(88, 3.6 * Math.max(0.8, vscale), 46);
      const terraceMat = new THREE.MeshStandardMaterial({
        color: 0x3d2b1c,
        roughness: 0.96
      });
      const terrace = new THREE.Mesh(terraceGeo, terraceMat);
      terrace.position.set(yardCenter.x + 8.0, groundY + 2.0 * vscale, yardCenter.z - 12.0);
      this.stockpileGroup.add(terrace);

      // 2. High-Visibility Safety Boundary Ring (Amber hazard zone perimeter)
      const ringGeo = new THREE.RingGeometry(72.0, 75.5, 40);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.scale.set(1.22, 0.94, 1.0);
      ring.position.set(yardCenter.x, groundY + 1.2 * vscale, yardCenter.z);
      this.stockpileGroup.add(ring);

      // 3. Massive Primary Raw Coal Stockpile Ridge (76m length, 22m high)
      const coalGeo = new THREE.ConeGeometry(38, 22.0 * Math.max(0.7, vscale), 28);
      const coalMat = new THREE.MeshStandardMaterial({
        color: 0x141416,
        roughness: 0.98,
        metalness: 0.04
      });
      const coalMound = new THREE.Mesh(coalGeo, coalMat);
      coalMound.scale.set(1.45, 1.0, 0.85); // Elongated coal ridge
      const cOffX = -38.0, cOffZ = -28.0;
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
        color: 0x7a2818,
        roughness: 0.95,
        metalness: 0.08
      });
      const oreMound = new THREE.Mesh(oreGeo, oreMat);
      const oOffX = 44.0, oOffZ = -24.0;
      const oreH = this.getRenderedTerrainHeight(yardCenter.x + oOffX, yardCenter.z + oOffZ);
      oreMound.position.set(
        yardCenter.x + oOffX,
        (oreH - this.yMin) * vscale + 9.0 * Math.max(0.7, vscale),
        yardCenter.z + oOffZ
      );
      this.stockpileGroup.add(oreMound);

      // 5. Blended Sinter Feed Ore Mound (52m diameter, 14m high)
      const sinterGeo = new THREE.ConeGeometry(26, 14.0 * Math.max(0.7, vscale), 20);
      const sinterMat = new THREE.MeshStandardMaterial({
        color: 0x8a4322,
        roughness: 0.94
      });
      const sinterMound = new THREE.Mesh(sinterGeo, sinterMat);
      const sOffX = -36.0, sOffZ = 32.0;
      const sinterH = this.getRenderedTerrainHeight(yardCenter.x + sOffX, yardCenter.z + sOffZ);
      sinterMound.position.set(
        yardCenter.x + sOffX,
        (sinterH - this.yMin) * vscale + 7.0 * Math.max(0.7, vscale),
        yardCenter.z + sOffZ
      );
      this.stockpileGroup.add(sinterMound);

      // 6. Active Run-of-Mine Spoil Bank Finger (48m x 24m)
      const spoilGeo = new THREE.BoxGeometry(48, 8.5 * Math.max(0.7, vscale), 24);
      const spoilMat = new THREE.MeshStandardMaterial({
        color: 0x3d2b1f,
        roughness: 0.96
      });
      const spoilMound = new THREE.Mesh(spoilGeo, spoilMat);
      const spOffX = 42.0, spOffZ = 32.0;
      const spoilH = this.getRenderedTerrainHeight(yardCenter.x + spOffX, yardCenter.z + spOffZ);
      spoilMound.position.set(
        yardCenter.x + spOffX,
        (spoilH - this.yMin) * vscale + 4.25 * Math.max(0.7, vscale),
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

      // Safety yellow and black zebra-striped wheel stop bunds along dump bay lip
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

      // 9. Perimeter Warning Stanchions with Amber Beacons (12 beacons)
      const poleGeo = new THREE.CylinderGeometry(0.35, 0.35, 5.5, 8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.7 });
      const beaconGeo = new THREE.SphereGeometry(0.9, 8, 8);
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const bx = yardCenter.x + Math.cos(ang) * 72.0 * 1.22;
        const bz = yardCenter.z + Math.sin(ang) * 72.0 * 0.94;
        const by = (this.getRenderedTerrainHeight(bx, bz) - this.yMin) * vscale;
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(bx, by + 2.75, bz);
        const beacon = new THREE.Mesh(beaconGeo, beaconMat);
        beacon.position.set(bx, by + 5.7, bz);
        this.stockpileGroup.add(pole);
        this.stockpileGroup.add(beacon);
      }

      // 10. Floating 3D Billboard Sprite Badge: "DEPOSITION CENTER — STOCKPILE YARD"
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 150;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(10, 15, 26, 0.94)';
      ctx.fillRect(0, 0, 640, 150);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 6;
      ctx.strokeRect(4, 4, 632, 142);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 22px "Space Grotesk", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('COAL HANDLING PLANT (CHP) — KIRANDUL COMPLEX', 320, 38);

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 44px "Space Grotesk", sans-serif';
      ctx.fillText('DEPOSITION CENTER & STOCKPILE YARD', 320, 88);

      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 22px "Space Grotesk", monospace';
      ctx.fillText('● ACTIVE UNLOADING BAYS & RECEIVING HOPPER', 320, 126);

      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(yardCenter.x, groundY + 54.0 * Math.max(0.8, vscale), yardCenter.z);
      sprite.scale.set(130, 32, 1);
      this.stockpileGroup.add(sprite);

      if (scene) scene.add(this.stockpileGroup);
      return this.stockpileGroup;
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

      // Ultra-class haul truck dimensions (CAT 797F / NMDC Class)
      const L = 17.5;
      const W = 11.2;
      const H = 8.5;
      const wheelR = 2.15;
      const wheelW = 1.65;

      // 1. Heavy Box-Section Chassis Frame
      // Lower frame rails and deck sitting above axles
      const chassisGeo = new THREE.BoxGeometry(5.2, 1.6, 14.5);
      const chassisMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8, metalness: 0.2 });
      const chassis = new THREE.Mesh(chassisGeo, chassisMat);
      chassis.position.set(0, 2.95, 0);
      truck.add(chassis);

      // Heavy Front Bumper & Lower Grille Deflector
      const bumperGeo = new THREE.BoxGeometry(10.2, 2.2, 2.2);
      const bumperMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 });
      const bumper = new THREE.Mesh(bumperGeo, bumperMat);
      bumper.position.set(0, 2.4, 6.2);
      truck.add(bumper);

      // 2. Six Ultra-Class Mining Wheels (Front 2 steer, Rear 4 dual)
      // Wheel centers at Y = wheelR (2.15m), so bottom of tire touches exact local Y = 0.0
      const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 20);
      wheelGeo.rotateZ(Math.PI / 2);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.94 });
      const hubGeo = new THREE.CylinderGeometry(wheelR * 0.42, wheelR * 0.42, wheelW + 0.1, 16);
      hubGeo.rotateZ(Math.PI / 2);
      const hubMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.5 });

      const wheelPositions = [
        // Front Axle (Z = +4.8m)
        [-4.8, wheelR, 4.8],
        [ 4.8, wheelR, 4.8],
        // Rear Axle Dual Outer & Inner (Z = -4.8m)
        [-5.15, wheelR, -4.8],
        [-3.45, wheelR, -4.8],
        [ 3.45, wheelR, -4.8],
        [ 5.15, wheelR, -4.8]
      ];

      wheelPositions.forEach(pos => {
        const wGroup = new THREE.Group();
        const tire = new THREE.Mesh(wheelGeo, wheelMat);
        const hub = new THREE.Mesh(hubGeo, hubMat);
        wGroup.add(tire);
        wGroup.add(hub);
        wGroup.position.set(...pos);
        truck.add(wGroup);
      });

      // 3. Operators Cabin (Elevated on Front-Left Deck)
      const cabGeo = new THREE.BoxGeometry(3.6, 3.2, 3.8);
      const cabMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45 });
      const cab = new THREE.Mesh(cabGeo, cabMat);
      cab.position.set(-3.2, 5.6, 4.2);
      truck.add(cab);

      // Cab Windshield
      const winGeo = new THREE.BoxGeometry(3.2, 1.6, 0.4);
      const winMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.15, metalness: 0.85 });
      const win = new THREE.Mesh(winGeo, winMat);
      win.position.set(-3.2, 6.1, 6.15);
      truck.add(win);

      // Radiator & Air Filter Enclosure (Front-Right Deck)
      const engGeo = new THREE.BoxGeometry(4.6, 2.6, 4.2);
      const engMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
      const eng = new THREE.Mesh(engGeo, engMat);
      eng.position.set(2.4, 4.8, 4.2);
      truck.add(eng);

      // Grille mesh in front of radiator
      const grilleGeo = new THREE.BoxGeometry(4.2, 1.8, 0.4);
      const grilleMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95 });
      const grille = new THREE.Mesh(grilleGeo, grilleMat);
      grille.position.set(2.4, 4.8, 6.35);
      truck.add(grille);

      // Headlights on bumper
      const hlGeo = new THREE.BoxGeometry(1.0, 0.7, 0.4);
      const hlMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
      const hl1 = new THREE.Mesh(hlGeo, hlMat);
      hl1.position.set(-4.2, 3.2, 7.3);
      truck.add(hl1);
      const hl2 = new THREE.Mesh(hlGeo, hlMat);
      hl2.position.set( 4.2, 3.2, 7.3);
      truck.add(hl2);

      // Forward High-Intensity Work Spotlight
      const spot = new THREE.SpotLight(0xfffbeb, 1.5, 120, Math.PI / 6, 0.4);
      spot.position.set(0, 5.2, 7.4);
      spot.target.position.set(0, 0, 7.4 + 90);
      truck.add(spot);
      truck.add(spot.target);

      // 4. Articulated Large Dump Bed & Dumping Pivot (Hinged at rear axle)
      const bedPivot = new THREE.Group();
      bedPivot.name = 'BedPivot';
      const hingeY = 3.8;
      const hingeZ = -4.8;
      bedPivot.position.set(0, hingeY, hingeZ);

      // Dump Bed V-Shaped Basin Body
      const bedGeo = new THREE.BoxGeometry(10.0, 3.8, 12.5);
      const bedMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.55 });
      const bed = new THREE.Mesh(bedGeo, bedMat);
      bed.position.set(0, 5.8 - hingeY, 1.0 - hingeZ);
      bed.rotation.x = -0.05; // Resting dump rake angle
      bedPivot.add(bed);

      // Overhead Protective Canopy (Rock Shield extending over cab)
      const canopyGeo = new THREE.BoxGeometry(10.2, 0.5, 4.6);
      const canopyMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.6 });
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.position.set(0, 8.2 - hingeY, 7.8 - hingeZ);
      bedPivot.add(canopy);

      // Raw Iron Ore / Coal Payload Mesh in dump bed
      const payloadGeo = new THREE.BoxGeometry(8.8, 2.2, 10.0);
      const payloadMat = new THREE.MeshStandardMaterial({ color: 0x1e1b18, roughness: 0.95, metalness: 0.05 });
      const payload = new THREE.Mesh(payloadGeo, payloadMat);
      payload.position.set(0, 6.6 - hingeY, 0.8 - hingeZ);
      bedPivot.add(payload);
      truck.payloadMesh = payload;

      // Telescopic Hydraulic Lift Rams
      const ramGeo = new THREE.CylinderGeometry(0.4, 0.4, 3.8, 12);
      const ramMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.2 });
      const ramL = new THREE.Mesh(ramGeo, ramMat);
      ramL.position.set(-2.2, 4.6 - hingeY, 2.8 - hingeZ);
      bedPivot.add(ramL);
      const ramR = new THREE.Mesh(ramGeo, ramMat);
      ramR.position.set( 2.2, 4.6 - hingeY, 2.8 - hingeZ);
      bedPivot.add(ramR);

      truck.bedPivot = bedPivot;
      truck.add(bedPivot);

      // 5. Fog-Guard Radar Safety Ring (Concentric hazard boundary)
      const ringGeo = new THREE.RingGeometry(11.5, 13.5, 24);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.2;
      truck.add(ring);
      truck.radarRing = ring;

      // 6. Visible Illuminated Vehicle ID Tag Sprite
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
      sprite.position.set(0, 12.5, 0);
      sprite.scale.set(22, 6.8, 1);
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

        // Out-of-order sequence guard: discard stale packets from slower/colder serverless responses
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
        targetWorld.y += 0.12; // Contact patch elevation offset

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
          // If difference is large (> 45m, e.g. initial load or scenario change), snap immediately
          const distToTarget = Math.hypot(targetWorld.x - item.mesh.position.x, targetWorld.z - item.mesh.position.z);
          if (distToTarget > 45.0) {
            item.mesh.position.set(targetWorld.x, targetWorld.y, targetWorld.z);
            item.mesh.rotation.y = targetYaw;
          }
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
     * Real-time 4-wheel contact patch sampling, critically damped suspension,
     * longitudinal slope pitching, lateral roll, and switchback steering smoothing.
     */
    stepInterpolation(dt = 0.016) {
      for (const vId in this.truckObjects) {
        const item = this.truckObjects[vId];
        if (!item || !item.mesh || !item.initialized) continue;

        // Smooth continuous dead-reckoning extrapolation between 1-second server polls:
        // Continues advancing targetPos forward along its current heading so the truck NEVER freezes or stutters
        if (item.isMoving && item.speedMps > 0.1) {
          const fwdX = -Math.sin(item.targetYaw);
          const fwdZ = -Math.cos(item.targetYaw);
          item.targetPos.x += fwdX * item.speedMps * dt;
          item.targetPos.z += fwdZ * item.speedMps * dt;
        }

        // Smoothly interpolate horizontal position (X, Z) towards backend target
        const alpha = Math.min(1.0, dt * 6.0);
        item.mesh.position.x += (item.targetPos.x - item.mesh.position.x) * alpha;
        item.mesh.position.z += (item.targetPos.z - item.mesh.position.z) * alpha;

        const posX = item.mesh.position.x;
        const posZ = item.mesh.position.z;

        // Smooth yaw rotation lerp with rate-limiting around hairpins
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

        // 4-Wheel Contact Patch Terrain Sampling:
        // Half-wheelbase = 4.8m, half-track = 4.5m
        const Lhalf = 4.8;
        const Whalf = 4.5;

        // Contact patch positions (FL, FR, RL, RR)
        const flX = posX + fwdX * Lhalf - rightX * Whalf;
        const flZ = posZ + fwdZ * Lhalf - rightZ * Whalf;
        const frX = posX + fwdX * Lhalf + rightX * Whalf;
        const frZ = posZ + fwdZ * Lhalf + rightZ * Whalf;
        const rlX = posX - fwdX * Lhalf - rightX * Whalf;
        const rlZ = posZ - fwdZ * Lhalf - rightZ * Whalf;
        const rrX = posX - fwdX * Lhalf + rightX * Whalf;
        const rrZ = posZ - fwdZ * Lhalf + rightZ * Whalf;

        // Exact rendered terrain heights at contact points
        const hFL = (this.getRenderedTerrainHeight(flX, flZ) - this.yMin) * this.vscale;
        const hFR = (this.getRenderedTerrainHeight(frX, frZ) - this.yMin) * this.vscale;
        const hRL = (this.getRenderedTerrainHeight(rlX, rlZ) - this.yMin) * this.vscale;
        const hRR = (this.getRenderedTerrainHeight(rrX, rrZ) - this.yMin) * this.vscale;
        const hMid = (this.getRenderedTerrainHeight(posX, posZ) - this.yMin) * this.vscale;

        const hFront = (hFL + hFR) * 0.5;
        const hRear = (hRL + hRR) * 0.5;
        const hLeft = (hFL + hRL) * 0.5;
        const hRight = (hFR + hRR) * 0.5;

        // Elevation guarantee: wheels sit on road surface without clipping
        const axleCenterH = (hFront + hRear) * 0.5;
        const maxContactH = Math.max(hFL, hFR, hRL, hRR);
        const targetY = Math.max(axleCenterH, hMid, maxContactH - 0.25) + 0.12;

        // Critically damped vertical suspension smoothing
        item.mesh.position.y += (targetY - item.mesh.position.y) * Math.min(1.0, dt * 10.0);

        // Longitudinal pitch along slope (uphill: nose up -> negative rotation.x)
        const wheelbase = Lhalf * 2.0;
        const slopePitch = -Math.atan2(hFront - hRear, wheelbase);
        const clampedPitch = Math.max(-0.45, Math.min(0.45, slopePitch));
        item.mesh.rotation.x += (clampedPitch - item.mesh.rotation.x) * Math.min(1.0, dt * 8.0);

        // Lateral roll across slope/camber (banking right -> negative rotation.z)
        const trackWidth = Whalf * 2.0;
        const slopeRoll = -Math.atan2(hRight - hLeft, trackWidth);
        const clampedRoll = Math.max(-0.20, Math.min(0.20, slopeRoll));
        item.mesh.rotation.z += (clampedRoll - item.mesh.rotation.z) * Math.min(1.0, dt * 8.0);

        // Authentic Dump Bed Dumping Animation at Deposition Center (Stockpile Yard / WP 0)
        if (item.mesh.bedPivot) {
          const bData = item.backendData;
          const isDumping = bData && (bData.lifecycle_state === 'UNLOADING' || bData.lifecycle_state === 'DUMPING');
          const targetBedAngle = isDumping ? -0.585 : 0.0; // ~33.5 degrees dump tilt
          const bedSpeed = isDumping ? 1.8 : 2.2;
          item.mesh.bedPivot.rotation.x += (targetBedAngle - item.mesh.bedPivot.rotation.x) * Math.min(1.0, dt * bedSpeed);

          if (item.mesh.payloadMesh) {
            // Empties payload as bed tilts up or if payload_tons is 0
            const hasPayload = bData && bData.payload_tons !== undefined ? (bData.payload_tons > 1.0) : true;
            item.mesh.payloadMesh.visible = hasPayload && (item.mesh.bedPivot.rotation.x > -0.22);
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
      const elev = ((item.mesh.position.y - 0.12) / this.vscale) + this.yMin;
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
      if (this.stockpileGroup) this.stockpileGroup.visible = this.showRoads;
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
      this.buildStockpileYard(scene, vscale);
    }

    /**
     * Optimal camera starting position framing Deposit 14 pit and surrounding Bailadila mountain range.
     */
    getRecommendedCameraOverview() {
      const pC = this.pitPos;
      return {
        position: new THREE.Vector3(pC.x + 1200, 1050, pC.z + 1400),
        target: new THREE.Vector3(pC.x, 480, pC.z - 200)
      };
    }
  }

  // Export to global scope
  global.BailadilaTerrainEngine = BailadilaTerrainEngine;
  global.bailadilaEngine = new BailadilaTerrainEngine();

})(typeof window !== 'undefined' ? window : this);
