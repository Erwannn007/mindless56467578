// Deterministic world description: elevation, moisture, paths, forests.
// Every query is a pure function of (seed, x, z), so chunks match at their borders.

import { createSimplex, fbm, ridged, smoothstep, stringToSeed, clamp } from '../noise.js';
import { WATER_LEVEL } from '../config.js';

export class WorldGen {
  constructor(seedStr) {
    this.seedStr = seedStr;
    const seed = stringToSeed(seedStr);
    this.seed = seed;
    this.nWarp = createSimplex(seed + 11);
    this.nCont = createSimplex(seed + 23);
    this.nHill = createSimplex(seed + 37);
    this.nMask = createSimplex(seed + 41);
    this.nMount = createSimplex(seed + 53);
    this.nDetail = createSimplex(seed + 67);
    this.nRiver = createSimplex(seed + 79);
    this.nPath = createSimplex(seed + 83);
    this.nMoist = createSimplex(seed + 97);
    this.nForest = createSimplex(seed + 101);
    this._s = { h: 0, path: 0, river: 0, moisture: 0, forest: 0 };
  }

  // Full sample. Returns a shared object: copy values before calling again.
  sample(x, z) {
    const s = this._s;
    const wx = x + 45 * this.nWarp(x / 420, z / 420);
    const wz = z + 45 * this.nWarp(x / 420 + 31.7, z / 420 - 12.3);

    const cont = fbm(this.nCont, wx / 1300, wz / 1300, 3);
    let h = 5 + cont * 20;

    const landness = smoothstep(-0.35, 0.3, cont);
    const hills = fbm(this.nHill, wx / 180, wz / 180, 4);
    h += hills * (4 + 9 * landness);

    const mmask = smoothstep(0.2, 0.65, this.nMask(wx / 1700, wz / 1700)) * landness;
    if (mmask > 0) h += ridged(this.nMount, wx / 360, wz / 360, 4) * 85 * mmask;

    h += this.nDetail(x / 21, z / 21) * 0.45;

    // Rivers: thin valleys along the zero-set of a low-frequency noise
    const r = Math.abs(fbm(this.nRiver, wx / 850, wz / 850, 2));
    const bed = WATER_LEVEL - 1.7;
    const rv = smoothstep(0.008, 0.06, r);
    const river = 1 - rv;
    if (h > bed) h = bed + (h - bed) * (rv * rv * (1.6 - 0.6 * rv));

    // Paths: winding lines following another zero-set
    const pn = Math.abs(fbm(this.nPath, wx / 320, wz / 320, 2));
    let path = 1 - smoothstep(0.007, 0.017, pn);
    path *= smoothstep(WATER_LEVEL + 0.6, WATER_LEVEL + 1.6, h) * (1 - mmask * 0.8);
    h -= path * 0.12;

    const moisture = clamp(0.5 + 0.55 * fbm(this.nMoist, x / 650, z / 650, 3) + river * 0.3, 0, 1);
    const forest = clamp(fbm(this.nForest, x / 240, z / 240, 3) * 1.6 + (moisture - 0.5) * 0.9, -1, 1);

    s.h = h; s.path = path; s.river = river; s.moisture = moisture; s.forest = forest;
    return s;
  }

  height(x, z) {
    return this.sample(x, z).h;
  }

  // Height matching the rendered mesh (bilinear over the 1 m grid, same diagonal split)
  meshHeight(x, z) {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const h00 = this.height(x0, z0), h10 = this.height(x0 + 1, z0);
    const h01 = this.height(x0, z0 + 1), h11 = this.height(x0 + 1, z0 + 1);
    // triangles (00,01,10) and (10,01,11)
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  normalAt(x, z, e = 1) {
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  }

  // Find a pleasant dry, gentle spot near (x, z) to start the player
  findSpawn(x, z) {
    for (let ring = 0; ring < 60; ring++) {
      const steps = Math.max(1, ring * 6);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const px = x + Math.cos(a) * ring * 24, pz = z + Math.sin(a) * ring * 24;
        const s = this.sample(px, pz);
        if (s.h < WATER_LEVEL + 2 || s.h > 30 || s.forest > 0.25) continue;
        const n = this.normalAt(px, pz, 2);
        if (n[1] > 0.95) return { x: px, z: pz };
      }
    }
    return { x, z };
  }
}
