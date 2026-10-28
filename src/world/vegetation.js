// Trees, bushes, rocks, flowers and mushrooms for one chunk, merged into a PropBuilder.

import { mulberry32, hash3i, smoothstep } from '../noise.js';
import { CHUNK_SIZE, WATER_LEVEL } from '../config.js';
import { MAT } from '../render/texel.js';
import { SHAPES } from './shapes.js';
import { sampleGrid } from './terrain.js';
import { poiBlocks } from './structures.js';

const canopyAO = (n) => 0.55 + 0.45 * (n.y * 0.5 + 0.5);
const LEAF_TINTS = [
  [1, 1, 1], [1, 1, 1], [1.08, 1.04, 0.82], [0.86, 0.95, 1.0], [1.12, 1.02, 0.78],
];
const FLOWER_COLORS = [[0.96, 0.94, 0.86], [0.98, 0.84, 0.35], [0.94, 0.6, 0.72], [0.72, 0.62, 0.94], [0.95, 0.5, 0.4]];

function roundTree(b, x, y, z, rng, scale, tint) {
  const th = (2.4 + rng() * 1.6) * scale;
  const tr = 0.22 * scale + rng() * 0.08;
  const lean = (rng() - 0.5) * 0.12;
  b.addAt(SHAPES.trunk, x, y - 0.3, z, rng() * 6, tr, th + 0.6, tr, { mat: MAT.BARK, color: [1, 1, 1], ao: 0.9 }, lean, 0);
  const cy = y + th + 0.9 * scale;
  const R = (1.7 + rng() * 0.9) * scale;
  const opts = { mat: MAT.LEAVES, color: tint, aoFn: canopyAO, wind: 1 };
  b.addAt(SHAPES.blobs[Math.floor(rng() * 3)], x + lean * th, cy, z, rng() * 6, R, R * 0.82, R, opts);
  const subs = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < subs; i++) {
    const a = rng() * Math.PI * 2;
    const r2 = R * (0.55 + rng() * 0.2);
    b.addAt(SHAPES.blobs[Math.floor(rng() * 3)], x + Math.cos(a) * R * 0.75, cy - R * 0.25 + rng() * R * 0.4, z + Math.sin(a) * R * 0.75, rng() * 6, r2, r2 * 0.85, r2, opts);
  }
  return tr + 0.1;
}

function pineTree(b, x, y, z, rng, scale) {
  const th = (1.2 + rng() * 0.6) * scale;
  const tr = 0.2 * scale;
  b.addAt(SHAPES.trunk, x, y - 0.3, z, rng() * 6, tr, th + 1.5 * scale, tr, { mat: MAT.BARK, color: [0.9, 0.85, 0.85], ao: 0.85 });
  const layers = 3 + Math.floor(rng() * 2);
  const opts = { mat: MAT.LEAVES, color: [0.78, 0.92, 0.88], aoFn: canopyAO, wind: 0.6 };
  let cy = y + th;
  let R = (1.9 + rng() * 0.5) * scale;
  for (let i = 0; i < layers; i++) {
    const hgt = R * 1.3;
    b.addAt(SHAPES.cone, x, cy, z, rng() * 6, R, hgt, R, opts);
    cy += hgt * 0.5;
    R *= 0.72;
  }
  return tr + 0.1;
}

export function buildVegetation(b, gen, terr, cx, cz, pois, colliders) {
  const S = CHUNK_SIZE, x0 = cx * S, z0 = cz * S;
  const rng = mulberry32(hash3i(cx, cz, 3, gen.seed));
  const cell = 4;
  const cells = S / cell;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const x = x0 + (i + 0.15 + rng() * 0.7) * cell;
      const z = z0 + (j + 0.15 + rng() * 0.7) * cell;
      const roll = rng(), roll2 = rng(), kind = rng();
      const s = sampleGrid(terr, x, z);
      const h = s.h;
      if (h < WATER_LEVEL + 0.6) continue;
      if (poiBlocks(pois, x, z, 1.5)) continue;
      const forest = s.forest, moist = s.moist;
      const steep = s.ny < 0.8;
      const onPath = s.path > 0.25;
      const fd = smoothstep(-0.05, 0.45, forest);
      const alpine = smoothstep(24, 40, h);

      // Trees
      const treeP = onPath || steep ? 0 : fd * 0.62 + 0.015 + alpine * 0.05;
      if (roll < treeP && h < 70) {
        const scale = 0.85 + roll2 * 0.5;
        let r;
        if (alpine > 0.5 || (moist < 0.35 && kind < 0.5) || kind < 0.12) r = pineTree(b, x, h, z, rng, scale);
        else r = roundTree(b, x, h, z, rng, scale, LEAF_TINTS[Math.floor(kind * LEAF_TINTS.length)]);
        colliders.push({ kind: 'circle', x, z, r, y0: h - 1, y1: h + 4 });
        continue;
      }
      // Bushes
      if (roll < treeP + 0.05 + fd * 0.08 && !onPath && !steep) {
        const R = 0.5 + roll2 * 0.5;
        b.addAt(SHAPES.smallBlob, x, h + R * 0.4, z, kind * 6, R * 1.2, R * 0.8, R, { mat: MAT.LEAVES, color: [0.9, 1, 0.92], aoFn: canopyAO, wind: 0.5 });
        if (kind < 0.3) b.addAt(SHAPES.smallBlob, x + R * 0.7, h + R * 0.3, z + R * 0.3, kind * 9, R * 0.7, R * 0.55, R * 0.7, { mat: MAT.LEAVES, color: [0.9, 1, 0.92], aoFn: canopyAO, wind: 0.5 });
        continue;
      }
      // Rocks (more on slopes and in the mountains)
      const rockP = 0.02 + (steep ? 0.12 : 0) + alpine * 0.06;
      if (roll2 < rockP && !onPath) {
        const R = 0.35 + kind * kind * 1.6;
        b.addAt(SHAPES.rocks[Math.floor(kind * 3)], x, h - R * 0.25, z, roll * 20, R * (1 + roll2), R * 0.7, R, { mat: MAT.STONE, color: [1, 0.98, 0.95], ao: 1 }, (roll - 0.5) * 0.3, 0);
        if (R > 0.6) colliders.push({ kind: 'circle', x, z, r: R * 0.9, y0: h - 1, y1: h + R * 0.5 });
        continue;
      }
      // Flower clusters in open meadows
      const meadow = smoothstep(0.35, 0.75, moist) * (1 - fd);
      if (kind < 0.1 * meadow && !onPath && !steep) {
        const c = FLOWER_COLORS[Math.floor(roll2 * FLOWER_COLORS.length)];
        const n = 5 + Math.floor(roll * 8);
        for (let k = 0; k < n; k++) {
          const fx = x + (rng() - 0.5) * 2.2, fz = z + (rng() - 0.5) * 2.2;
          const fy = sampleGrid(terr, fx, fz).h;
          const fh = 0.2 + rng() * 0.25;
          b.addAt(SHAPES.stem, fx, fy - 0.05, fz, 0, 0.018, fh, 0.018, { mat: MAT.PAINT, color: [0.33, 0.52, 0.22], ao: 1 });
          b.addAt(SHAPES.petal, fx, fy + fh, fz, rng() * 3, 0.07, 0.05, 0.07, { mat: MAT.PAINT, color: c, ao: 1, wind: 0.3 });
        }
        continue;
      }
      // Forest floor: mushrooms, fallen logs, rare luminous flowers
      if (fd > 0.5 && !onPath && !steep) {
        if (kind < 0.06) {
          const red = roll2 < 0.5;
          for (let k = 0; k < 3; k++) {
            const mx = x + (rng() - 0.5) * 1.2, mz = z + (rng() - 0.5) * 1.2;
            const my = sampleGrid(terr, mx, mz).h;
            const ms = 0.12 + rng() * 0.12;
            b.addAt(SHAPES.stem, mx, my - 0.05, mz, 0, ms * 0.35, ms * 1.6, ms * 0.35, { mat: MAT.PAINT, color: [0.92, 0.88, 0.8], ao: 1 });
            b.addAt(SHAPES.cap, mx, my + ms * 1.4, mz, 0, ms, ms * 0.8, ms, { mat: MAT.PAINT, color: red ? [0.85, 0.28, 0.22] : [0.66, 0.48, 0.32], ao: 1 });
          }
        } else if (kind < 0.09) {
          const len = 2.5 + roll2 * 2;
          const ry = roll * 6;
          b.addAt(SHAPES.log, x, h + 0.2, z, ry, len, 0.28, 0.28, { mat: MAT.BARK, color: [0.95, 0.9, 0.85], ao: 0.9 });
        } else if (kind < 0.105) {
          for (let k = 0; k < 4; k++) {
            const fx = x + (rng() - 0.5) * 1.4, fz = z + (rng() - 0.5) * 1.4;
            const fy = sampleGrid(terr, fx, fz).h;
            b.addAt(SHAPES.stem, fx, fy - 0.05, fz, 0, 0.02, 0.35, 0.02, { mat: MAT.PAINT, color: [0.3, 0.5, 0.35], ao: 1 });
            b.addAt(SHAPES.petal, fx, fy + 0.35, fz, rng() * 3, 0.08, 0.06, 0.08, { mat: MAT.GLOW, color: [0.5, 0.85, 1.0], ao: 1 });
          }
        }
      }
    }
  }
}
