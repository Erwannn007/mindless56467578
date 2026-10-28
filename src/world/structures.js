// Points of interest: deterministic placement per 128 m region + geometry builders.

import { mulberry32, hash3i } from '../noise.js';
import { WATER_LEVEL } from '../config.js';
import { MAT } from '../render/texel.js';
import { SHAPES } from './shapes.js';

const REGION = 128;

const TYPES = [
  { type: 'arch', name: 'Arche ancienne', w: 0.22, radius: 6, flat: 0.86 },
  { type: 'ruins', name: 'Ruines oubliées', w: 0.22, radius: 8, flat: 0.9 },
  { type: 'circle', name: 'Cercle de pierres', w: 0.16, radius: 8.5, flat: 0.9 },
  { type: 'cabin', name: 'Cabane forestière', w: 0.2, radius: 6, flat: 0.95 },
  { type: 'monolith', name: 'Monolithe', w: 0.12, radius: 5, flat: 0.92 },
  { type: 'gazebo', name: 'Kiosque paisible', w: 0.1, radius: 4.5, flat: 0.93 },
];

export class POIRegistry {
  constructor(gen) {
    this.gen = gen;
    this.cache = new Map();
  }

  region(rx, rz) {
    const key = rx + ',' + rz;
    if (this.cache.has(key)) return this.cache.get(key);
    const poi = this._generate(rx, rz);
    this.cache.set(key, poi);
    return poi;
  }

  _generate(rx, rz) {
    const gen = this.gen;
    const rng = mulberry32(hash3i(rx, rz, 7, gen.seed));
    if (rng() > 0.62) return null;
    let total = 0;
    for (const t of TYPES) total += t.w;
    let pick = rng() * total, def = TYPES[0];
    for (const t of TYPES) { pick -= t.w; if (pick <= 0) { def = t; break; } }
    // try a few spots in the region for a suitable site
    for (let attempt = 0; attempt < 4; attempt++) {
      const x = rx * REGION + 20 + rng() * (REGION - 40);
      const z = rz * REGION + 20 + rng() * (REGION - 40);
      const s = gen.sample(x, z);
      if (s.h < WATER_LEVEL + 1.4 || s.h > 60 || s.path > 0.3) continue;
      const n = gen.normalAt(x, z, 3);
      if (n[1] < def.flat) continue;
      return {
        id: `${def.type}:${rx}:${rz}`, type: def.type, name: def.name, radius: def.radius,
        x, z, rot: rng() * Math.PI * 2, seed: hash3i(rx, rz, 99, gen.seed),
      };
    }
    return null;
  }

  // All POIs whose center lies in [x0,x1]x[z0,z1] expanded by margin
  near(x0, z0, x1, z1, margin = 16) {
    const out = [];
    const r0x = Math.floor((x0 - margin) / REGION), r1x = Math.floor((x1 + margin) / REGION);
    const r0z = Math.floor((z0 - margin) / REGION), r1z = Math.floor((z1 + margin) / REGION);
    for (let rz = r0z; rz <= r1z; rz++) {
      for (let rx = r0x; rx <= r1x; rx++) {
        const p = this.region(rx, rz);
        if (p && p.x >= x0 - margin && p.x <= x1 + margin && p.z >= z0 - margin && p.z <= z1 + margin) out.push(p);
      }
    }
    return out;
  }
}

// --- Builders ---------------------------------------------------------------

function local(poi) {
  const c = Math.cos(poi.rot), s = Math.sin(poi.rot);
  // local (lx, lz) -> world, matching THREE's Y rotation
  return (lx, lz) => [poi.x + lx * c + lz * s, poi.z - lx * s + lz * c];
}

function groundRange(gen, poi, r) {
  let lo = Infinity, hi = -Infinity;
  for (let a = 0; a < 8; a++) {
    const h = gen.height(poi.x + Math.cos(a * 0.785) * r, poi.z + Math.sin(a * 0.785) * r);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  const hc = gen.height(poi.x, poi.z);
  return { lo: Math.min(lo, hc), hi: Math.max(hi, hc), c: hc };
}

const STONE_TINTS = [[1, 1, 1], [1.04, 1.0, 0.93], [0.95, 0.96, 1.0]];

export function buildPOI(b, gen, poi, colliders) {
  const rng = mulberry32(poi.seed);
  const L = local(poi);
  const rot = poi.rot;
  const tint = STONE_TINTS[Math.floor(rng() * 3)];
  const stone = { mat: MAT.STONE, color: tint, ao: 1 };
  const box = (lx, y, lz, sx, sy, sz, opts, r = 0, tx = 0, tz = 0) => {
    const [x, z] = L(lx, lz);
    b.addAt(SHAPES.box, x, y, z, rot + r, sx, sy, sz, opts, tx, tz);
  };
  const boxCol = (lx, lz, hx, hz, y0, y1, r = 0) => {
    const [x, z] = L(lx, lz);
    colliders.push({ kind: 'box', x, z, hx, hz, rot: rot + r, y0, y1 });
  };
  const circleCol = (lx, lz, r, y0, y1) => {
    const [x, z] = L(lx, lz);
    colliders.push({ kind: 'circle', x, z, r, y0, y1 });
  };
  const jit = (a) => (rng() - 0.5) * a;

  if (poi.type === 'arch') {
    const g = groundRange(gen, poi, 3);
    const base = g.lo;
    const broken = rng() < 0.4;
    const span = 2.5 + rng() * 0.6;
    const blocks = 5;
    for (const side of [-1, 1]) {
      const px = side * span;
      box(px, base - 0.8, 0, 1.9, 2.2, 1.9, stone);
      let y = base + 0.3;
      for (let i = 0; i < blocks; i++) {
        const hgt = 0.9 + jit(0.15);
        box(px + jit(0.12), y + hgt / 2, jit(0.12), 1.3 + jit(0.1), hgt, 1.3 + jit(0.1), stone, jit(0.12));
        y += hgt;
      }
      boxCol(px, 0, 0.75, 0.75, base - 2, y);
    }
    const top = base + 0.3 + blocks * 0.9;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const lx = -span - 0.5 + (i + 0.5) * ((2 * span + 1) / n);
      if (broken && i >= 4 && i <= 5) {
        const [fx, fz] = L(lx + jit(2), 2.2 + rng() * 2);
        const fy = gen.height(fx, fz);
        b.addAt(SHAPES.box, fx, fy + 0.15, fz, rng() * 6, 0.95, 0.85, 1.3, stone, jit(0.5), jit(0.5));
        continue;
      }
      const tall = i === 3 ? 1.25 : 0.95;
      box(lx, top + tall / 2, jit(0.08), (2 * span + 1) / n - 0.04, tall, 1.35, stone, jit(0.05));
    }
    return;
  }

  if (poi.type === 'ruins') {
    const g = groundRange(gen, poi, 5);
    const base = g.lo + 0.1;
    const W = 9, Dp = 7;
    const walls = [];
    for (let i = 0; i < W; i++) walls.push([-W / 2 + 0.5 + i, -Dp / 2, 0]);
    for (let i = 0; i < W; i++) if (i < 3 || i > 5) walls.push([-W / 2 + 0.5 + i, Dp / 2, 0]);
    for (let i = 1; i < Dp - 1; i++) walls.push([-W / 2 + 0.5, -Dp / 2 + 0.5 + i, Math.PI / 2]);
    for (let i = 1; i < Dp - 1; i++) walls.push([W / 2 - 0.5, -Dp / 2 + 0.5 + i, Math.PI / 2]);
    const phase = rng() * 10;
    walls.forEach(([lx, lz, r], k) => {
      const prof = Math.sin(k * 0.45 + phase) * 1.6 + Math.sin(k * 1.3 + phase * 2) * 0.8 + 1.6;
      const rows = Math.max(0, Math.min(5, Math.round(prof + jit(1))));
      const [wx, wz] = L(lx, lz);
      const gy = gen.height(wx, wz);
      const y0 = Math.min(base, gy) - 1;
      box(lx, y0 + (base - y0) / 2, lz, 1.05, base - y0 + 0.05, 0.95, stone, r);
      for (let row = 0; row < rows; row++) {
        box(lx + jit(0.08), base + 0.4 + row * 0.8, lz + jit(0.08), 1.0 + jit(0.06), 0.78, 0.92, stone, r + jit(0.06));
      }
      if (rows > 0) boxCol(lx, lz, r ? 0.46 : 0.5, r ? 0.5 : 0.46, y0, base + rows * 0.8);
      if (rows > 0 && rows < 3 && rng() < 0.4) {
        const [fx, fz] = L(lx + jit(3), lz + (lz > 0 ? 1 : -1) * (1 + rng() * 2));
        b.addAt(SHAPES.box, fx, gen.height(fx, fz) + 0.1, fz, rng() * 6, 0.9, 0.7, 0.85, stone, jit(0.5), jit(0.5));
      }
    });
    // floor slabs and broken columns
    for (let i = 0; i < 6; i++) {
      const lx = jit(W - 3), lz = jit(Dp - 3);
      box(lx, base + 0.04, lz, 1.6 + jit(0.4), 0.16, 1.4 + jit(0.4), stone, jit(0.3));
    }
    for (const [cx, cz] of [[-2.5, -1.5], [2.5, -1.5], [-2.5, 1.5], [2.5, 1.5]]) {
      if (rng() < 0.4) continue;
      const hgt = 1 + rng() * 2.5;
      const [x, z] = L(cx, cz);
      b.addAt(SHAPES.stem, x, base - 0.2, z, rng(), 0.38, hgt, 0.38, stone);
      circleCol(cx, cz, 0.4, base - 1, base + hgt);
    }
    return;
  }

  if (poi.type === 'circle') {
    const g = groundRange(gen, poi, 6.5);
    const count = 9 + Math.floor(rng() * 3);
    const R = 6.2;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const lx = Math.cos(a) * R, lz = Math.sin(a) * R;
      const [x, z] = L(lx, lz);
      const gy = gen.height(x, z);
      if (rng() < 0.15) {
        b.addAt(SHAPES.box, x, gy + 0.2, z, rot - a + 1.4, 0.9, 0.55, 2.6, stone, jit(0.2), jit(0.2));
        continue;
      }
      const hgt = 2.2 + rng() * 1.4;
      b.addAt(SHAPES.boxBase, x, gy - 0.6, z, rot - a, 0.6, hgt + 0.6, 1.0, stone, jit(0.12), jit(0.12));
      colliders.push({ kind: 'circle', x, z, r: 0.6, y0: gy - 1, y1: gy + hgt });
    }
    const base = g.c;
    box(0, base + 0.1, 0, 1.8, 0.7, 1.1, stone, jit(0.3));
    boxCol(0, 0, 0.9, 0.55, base - 1, base + 0.45);
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2, r = 1.6 + rng() * 2;
      const [x, z] = L(Math.cos(a) * r, Math.sin(a) * r);
      const gy = gen.height(x, z);
      const c = rng() < 0.5 ? [0.55, 0.85, 1.0] : [0.8, 0.65, 1.0];
      b.addAt(SHAPES.stem, x, gy - 0.05, z, 0, 0.02, 0.3, 0.02, { mat: MAT.PAINT, color: [0.35, 0.55, 0.25], ao: 1 });
      b.addAt(SHAPES.petal, x, gy + 0.3, z, rng(), 0.09, 0.07, 0.09, { mat: MAT.GLOW, color: c, ao: 1 });
    }
    return;
  }

  if (poi.type === 'cabin') {
    const g = groundRange(gen, poi, 3.2);
    const floor = g.hi + 0.25;
    const wood = { mat: MAT.WOOD, color: [1, 1, 1], ao: 1 };
    const darkWood = { mat: MAT.WOOD, color: [0.75, 0.72, 0.7], ao: 1 };
    const roof = { mat: MAT.ROOF, color: [1, 1, 1], ao: 1 };
    const glow = { mat: MAT.GLOW, color: [1.0, 0.78, 0.4], ao: 1 };
    const W = 4.4, Dp = 5, Hh = 2.4, T = 0.25;
    // platform & step
    box(0, (floor + g.lo - 1.5) / 2, 0, W + 0.4, floor - g.lo + 1.5, Dp + 0.4, darkWood);
    boxCol(0, 0, W / 2 + 0.2, Dp / 2 + 0.2, g.lo - 1.5, floor);
    const [sx, sz] = L(0, Dp / 2 + 0.75);
    const sy = gen.height(sx, sz);
    const stepTop = Math.max(sy + 0.05, (floor + sy) / 2);
    box(0, (stepTop + sy - 1) / 2, Dp / 2 + 0.75, 1.4, stepTop - sy + 1, 0.9, darkWood);
    boxCol(0, Dp / 2 + 0.75, 0.7, 0.45, sy - 1, stepTop);
    // walls
    const wy = floor + Hh / 2;
    box(0, wy, -Dp / 2 + T / 2, W, Hh, T, wood);
    boxCol(0, -Dp / 2 + T / 2, W / 2, T / 2 + 0.05, floor, floor + Hh + 1);
    for (const side of [-1, 1]) {
      box(side * (W / 2 - T / 2), wy, 0, T, Hh, Dp, wood);
      boxCol(side * (W / 2 - T / 2), 0, T / 2 + 0.05, Dp / 2, floor, floor + Hh + 1);
      box(side * (W / 2 + 0.01), floor + 1.4, -0.4, 0.06, 0.7, 0.8, glow);
      box(side * (W / 2 + 0.03), floor + 1.4, -0.4, 0.06, 0.08, 0.95, darkWood);
    }
    const seg = (W - 1.1) / 2;
    for (const side of [-1, 1]) {
      const lx = side * (W / 2 - seg / 2);
      box(lx, wy, Dp / 2 - T / 2, seg, Hh, T, wood);
      boxCol(lx, Dp / 2 - T / 2, seg / 2, T / 2 + 0.05, floor, floor + Hh + 1);
    }
    box(0, floor + Hh - 0.25, Dp / 2 - T / 2, 1.1, 0.5, T, wood);
    // roof (ridge along local z)
    const [rx, rz] = L(0, 0);
    b.addAt(SHAPES.prism, rx, floor + Hh, rz, rot + Math.PI / 2, Dp + 0.8, 1.7, W + 0.9, roof);
    box(-W / 2 + 0.7, floor + Hh + 0.6, -Dp / 2 + 0.8, 0.6, 2.2, 0.6, stone);
    // interior: table + candle
    box(0.8, floor + 0.4, -1.3, 1.2, 0.8, 0.7, darkWood);
    box(0.8, floor + 0.9, -1.3, 0.08, 0.16, 0.08, glow);
    boxCol(0.8, -1.3, 0.6, 0.35, floor, floor + 0.8);
    // lantern post
    const [lx, lz] = L(1.6, Dp / 2 + 1.6);
    const ly = gen.height(lx, lz);
    b.addAt(SHAPES.boxBase, lx, ly - 0.3, lz, rot, 0.12, 2.3, 0.12, darkWood);
    b.addAt(SHAPES.box, lx, ly + 2.1, lz, rot, 0.28, 0.32, 0.28, glow);
    b.addAt(SHAPES.box, lx, ly + 2.3, lz, rot, 0.36, 0.06, 0.36, darkWood);
    colliders.push({ kind: 'circle', x: lx, z: lz, r: 0.15, y0: ly - 1, y1: ly + 2.4 });
    return;
  }

  if (poi.type === 'monolith') {
    const g = groundRange(gen, poi, 3);
    let y = g.hi - 0.1;
    const lo = g.lo - 1;
    for (const [s, hgt] of [[6, 0.4], [4.4, 0.4], [3, 0.4]]) {
      box(0, (y + hgt + lo) / 2, 0, s, y + hgt - lo, s, stone);
      boxCol(0, 0, s / 2, s / 2, lo, y + hgt);
      y += hgt;
    }
    box(0, y + 2.5, 0, 0.95, 5, 0.95, stone);
    const [x, z] = L(0, 0);
    b.addAt(SHAPES.cone, x, y + 5, z, rot + Math.PI / 4, 0.7, 0.9, 0.7, stone);
    boxCol(0, 0, 0.5, 0.5, lo, y + 6);
    const rune = { mat: MAT.GLOW, color: [0.55, 0.8, 1.0], ao: 1 };
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      box(Math.sin(a) * 0.49, y + 2.4 + i * 0.35, Math.cos(a) * 0.49, 0.12 + 0.3 * Math.abs(Math.cos(a)), 0.5, 0.12 + 0.3 * Math.abs(Math.sin(a)), rune);
    }
    return;
  }

  if (poi.type === 'gazebo') {
    const g = groundRange(gen, poi, 2.6);
    const floor = g.hi + 0.25;
    const wood = { mat: MAT.WOOD, color: [1, 1, 1], ao: 1 };
    const [cx, cz] = L(0, 0);
    b.addAt(SHAPES.stem, cx, g.lo - 1, cz, rot, 2.7, floor - g.lo + 1, 2.7, wood);
    // stem is open-ended: cap with a flat hexagonal top made of a short cone
    b.addAt(SHAPES.cone, cx, floor - 0.001, cz, rot, 2.7 * 0.7, 0.001, 2.7 * 0.7, wood);
    colliders.push({ kind: 'circle', x: cx, z: cz, r: 2.0, y0: g.lo - 1, y1: floor });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const [x, z] = L(Math.cos(a) * 1.75, Math.sin(a) * 1.75);
      b.addAt(SHAPES.boxBase, x, floor, z, rot + a, 0.16, 2.5, 0.16, wood);
      colliders.push({ kind: 'circle', x, z, r: 0.15, y0: floor, y1: floor + 2.5 });
    }
    b.addAt(SHAPES.cone, cx, floor + 2.45, cz, rot, 2.6, 1.5, 2.6, { mat: MAT.ROOF, color: [0.8, 0.9, 1.1], ao: 1 });
    b.addAt(SHAPES.box, cx, floor + 2.1, cz, rot, 0.25, 0.3, 0.25, { mat: MAT.GLOW, color: [1.0, 0.8, 0.45], ao: 1 });
    return;
  }
}

export function poiBlocks(pois, x, z, extra = 0) {
  for (const p of pois) {
    const dx = x - p.x, dz = z - p.z, r = p.radius + extra;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}
