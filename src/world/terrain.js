// Terrain and water geometry for one chunk.

import * as THREE from 'three';
import { CHUNK_SIZE, WATER_LEVEL } from '../config.js';
import { smoothstep, clamp } from '../noise.js';

// step: vertex spacing in meters (1 for near chunks, 4 for far ones)
export function buildTerrain(gen, cx, cz, step) {
  const S = CHUNK_SIZE;
  const n = S / step;
  const N = n + 1;
  const G = n + 3; // grid with one-vertex border for normals
  const x0 = cx * S, z0 = cz * S;

  const H = new Float32Array(G * G);
  const path = new Float32Array(N * N), moist = new Float32Array(N * N), forest = new Float32Array(N * N);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
      const inner = i >= 1 && j >= 1 && i <= N && j <= N;
      if (inner || step === 1) {
        const s = gen.sample(x, z);
        H[j * G + i] = s.h;
        if (inner) {
          const k = (j - 1) * N + (i - 1);
          path[k] = s.path; moist[k] = s.moisture; forest[k] = s.forest;
        }
      } else {
        H[j * G + i] = gen.height(x, z);
      }
    }
  }

  const skirt = step === 1 ? 2 : 6;
  const vcount = N * N + 4 * N;
  const pos = new Float32Array(vcount * 3);
  const nrm = new Float32Array(vcount * 3);
  const splat = new Float32Array(vcount * 4);
  const extra = new Float32Array(vcount * 2);

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = x0 + i * step, z = z0 + j * step;
      const h = H[(j + 1) * G + (i + 1)];
      let nx, nz, ny;
      if (step === 1) {
        nx = H[(j + 1) * G + i] - H[(j + 1) * G + i + 2];
        nz = H[j * G + i + 1] - H[(j + 2) * G + i + 1];
        ny = 2;
      } else {
        // match near-chunk normals (1 m central differences) so LOD borders shade alike
        nx = gen.height(x - 1, z) - gen.height(x + 1, z);
        nz = gen.height(x, z - 1) - gen.height(x, z + 1);
        ny = 2;
      }
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      nrm[k * 3] = nx; nrm[k * 3 + 1] = ny; nrm[k * 3 + 2] = nz;

      const rock = clamp(smoothstep(0.84, 0.66, ny) * 1.3 + smoothstep(46, 70, h) * 0.75, 0, 1.2);
      const sand = smoothstep(WATER_LEVEL + 1.6, WATER_LEVEL + 0.5, h);
      const f = forest[k];
      const dirt = Math.max(path[k], smoothstep(0.35, 0.9, f) * 0.42, h < WATER_LEVEL - 0.8 ? 0.6 : 0);
      splat[k * 4] = 0.5;
      splat[k * 4 + 1] = dirt;
      splat[k * 4 + 2] = sand;
      splat[k * 4 + 3] = rock;
      extra[k * 2] = moist[k];
      extra[k * 2 + 1] = f;
    }
  }

  // Skirts hide cracks between chunks of different resolution
  const edges = [];
  for (let i = 0; i < N; i++) edges.push(i);                 // z = z0
  for (let i = 0; i < N; i++) edges.push((N - 1) * N + i);   // z = z1
  for (let j = 0; j < N; j++) edges.push(j * N);             // x = x0
  for (let j = 0; j < N; j++) edges.push(j * N + N - 1);     // x = x1
  for (let e = 0; e < edges.length; e++) {
    const src = edges[e], dst = N * N + e;
    pos[dst * 3] = pos[src * 3];
    pos[dst * 3 + 1] = pos[src * 3 + 1] - skirt;
    pos[dst * 3 + 2] = pos[src * 3 + 2];
    for (let c = 0; c < 3; c++) nrm[dst * 3 + c] = nrm[src * 3 + c];
    for (let c = 0; c < 4; c++) splat[dst * 4 + c] = splat[src * 4 + c];
    for (let c = 0; c < 2; c++) extra[dst * 2 + c] = extra[src * 2 + c];
  }

  const idx = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * N + i, b = (j + 1) * N + i, c = j * N + i + 1, d = (j + 1) * N + i + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < n; i++) {
      const e = side * N + i;
      const a = edges[e], b = edges[e + 1], c = N * N + e, d = N * N + e + 1;
      idx.push(a, b, c, c, b, d, a, c, b, c, d, b); // both windings
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
  g.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();

  return {
    geometry: g, heights: H, gridSize: G, step, x0, z0, path, moist, forest,
    water: buildWater(H, G, n, step, x0, z0),
  };
}

// Interpolated terrain data from a near (1 m) chunk grid. Returns a shared object.
const _gs = { h: 0, ny: 1, path: 0, moist: 0, forest: 0 };
export function sampleGrid(t, x, z) {
  const G = t.gridSize, N = G - 2, H = t.heights;
  const lx = x - t.x0, lz = z - t.z0;
  const i = Math.min(N - 2, Math.max(0, Math.floor(lx))), j = Math.min(N - 2, Math.max(0, Math.floor(lz)));
  const fx = lx - i, fz = lz - j;
  const h00 = H[(j + 1) * G + i + 1], h10 = H[(j + 1) * G + i + 2];
  const h01 = H[(j + 2) * G + i + 1], h11 = H[(j + 2) * G + i + 2];
  let dx, dz;
  if (fx + fz <= 1) { _gs.h = h00 + (h10 - h00) * fx + (h01 - h00) * fz; dx = h10 - h00; dz = h01 - h00; }
  else { _gs.h = h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz); dx = h11 - h01; dz = h11 - h10; }
  _gs.ny = 1 / Math.sqrt(dx * dx + dz * dz + 1);
  const k = j * N + i;
  const bl = (a) => (a[k] * (1 - fx) + a[k + 1] * fx) * (1 - fz) + (a[k + N] * (1 - fx) + a[k + N + 1] * fx) * fz;
  _gs.path = bl(t.path); _gs.moist = bl(t.moist); _gs.forest = bl(t.forest);
  return _gs;
}

function buildWater(H, G, n, step, x0, z0) {
  const N = n + 1;
  const hAt = (i, j) => H[(j + 1) * G + (i + 1)];
  let any = false;
  for (let j = 0; j < N && !any; j++) for (let i = 0; i < N; i++) if (hAt(i, j) < WATER_LEVEL + 0.2) { any = true; break; }
  if (!any) return null;

  const pos = new Float32Array(N * N * 3);
  const depth = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = WATER_LEVEL; pos[k * 3 + 2] = z0 + j * step;
      depth[k] = WATER_LEVEL - hAt(i, j);
    }
  }
  const idx = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * N + i, b = (j + 1) * N + i, c = j * N + i + 1, d = (j + 1) * N + i + 1;
      if (Math.max(depth[a], depth[b], depth[c], depth[d]) <= -0.05) continue;
      idx.push(a, b, c, c, b, d);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Grass blades for a near chunk. Each tuft is 3 thin triangles, colored in the shader
// from the ground texel it grows on.
export function buildGrass(terr, cx, cz, spacing, seedHash, blockers) {
  const S = CHUNK_SIZE, x0 = cx * S, z0 = cz * S;
  const cells = Math.floor(S / spacing);
  const pos = [], base = [], info = [];
  let r = seedHash >>> 0;
  const rnd = () => { r = (Math.imul(r ^ (r >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return (r >>> 8) / 16777216; };
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const x = x0 + (i + rnd()) * spacing, z = z0 + (j + rnd()) * spacing;
      const s = sampleGrid(terr, x, z);
      const h = s.h;
      if (h < WATER_LEVEL + 0.7 || h > 58 || s.path > 0.35) { rnd(); rnd(); continue; }
      const moist = s.moist, forest = s.forest;
      const density = 0.35 + moist * 0.65 - Math.max(0, forest - 0.4) * 0.8;
      if (rnd() > density) { rnd(); continue; }
      if (s.ny < 0.84) { rnd(); continue; }
      if (blockers && blockers(x, z)) continue;
      const y = h - 0.03;
      const tall = 0.22 + moist * 0.3 + rnd() * 0.2;
      for (let b = 0; b < 3; b++) {
        const a = rnd() * Math.PI;
        const w = 0.045 + 0.03 * rnd();
        const hh = tall * (0.7 + 0.5 * rnd());
        const lean = (rnd() - 0.5) * 0.25;
        const dx = Math.cos(a) * w, dz = Math.sin(a) * w;
        const ox = (rnd() - 0.5) * 0.18, oz = (rnd() - 0.5) * 0.18;
        const bx = x + ox, bz = z + oz;
        pos.push(bx - dx, y, bz - dz, bx + dx, y, bz + dz, bx + lean, y + hh, bz + lean * 0.6);
        for (let v = 0; v < 3; v++) base.push(x, y, z);
        info.push(0, moist, forest, 0, moist, forest, 1, moist, forest);
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
  g.computeBoundingSphere();
  return g;
}
