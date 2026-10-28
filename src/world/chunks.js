// Streams chunks around the player: terrain (two resolutions), water, props, grass.

import * as THREE from 'three';
import { CHUNK_SIZE } from '../config.js';
import { hash3i } from '../noise.js';
import { buildTerrain, buildGrass } from './terrain.js';
import { buildVegetation } from './vegetation.js';
import { POIRegistry, buildPOI, poiBlocks } from './structures.js';
import { PropBuilder } from './builder.js';

export const SHADOW_LAYER = 1;

export class ChunkManager {
  constructor(scene, gen, materials, quality) {
    this.scene = scene;
    this.gen = gen;
    this.mat = materials;
    this.q = quality;
    this.chunks = new Map();
    this.pois = new POIRegistry(gen);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.center = [Infinity, Infinity];
  }

  setQuality(q) {
    this.q = q;
    this.center = [Infinity, Infinity];
  }

  key(cx, cz) { return cx + ',' + cz; }

  // Build/unload work, limited by a time budget (ms). Returns remaining job count.
  update(px, pz, budgetMs = 6) {
    const S = CHUNK_SIZE;
    const pcx = Math.floor(px / S), pcz = Math.floor(pz / S);
    const q = this.q;
    const t0 = performance.now();

    const jobs = [];
    for (let dz = -q.farRadius; dz <= q.farRadius; dz++) {
      for (let dx = -q.farRadius; dx <= q.farRadius; dx++) {
        // distance from player to chunk (in chunks), roughly circular
        const ccx = (pcx + dx + 0.5) * S - px, ccz = (pcz + dz + 0.5) * S - pz;
        const d = Math.hypot(ccx, ccz) / S;
        if (d > q.farRadius + 0.5) continue;
        const cx = pcx + dx, cz = pcz + dz;
        const c = this.chunks.get(this.key(cx, cz));
        const wantNear = d <= q.nearRadius + 0.5;
        const wantProps = d <= q.propRadius + 0.5;
        const wantGrass = q.grassRadius > 0 && d <= q.grassRadius + 0.75;
        // hysteresis: a near chunk stays detailed until it is well outside the near ring
        const step = wantNear || (c && c.step === 1 && d <= q.nearRadius + 1.5) ? 1 : 4;
        if (!c || c.step !== step || (wantProps && !c.props) || (wantGrass && !c.grass)) {
          jobs.push({ cx, cz, d, step, wantProps, wantGrass });
        }
        if (c && c.grass && d > q.grassRadius + 1.25) this._dropGrass(c);
      }
    }
    jobs.sort((a, b) => a.d - b.d);
    for (const job of jobs) {
      if (performance.now() - t0 > budgetMs) break;
      this._build(job);
    }

    // Unload far chunks; downgrade those that left the near ring
    for (const [k, c] of this.chunks) {
      const ccx = (c.cx + 0.5) * S - px, ccz = (c.cz + 0.5) * S - pz;
      const d = Math.hypot(ccx, ccz) / S;
      if (d > q.farRadius + 1.5) this._unload(k, c);
      else if (c.props && d > q.propRadius + 1.5) this._dropProps(c);
    }
    return jobs.length;
  }

  _build({ cx, cz, step, wantProps, wantGrass }) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = { cx, cz, step: 0, terrain: null, water: null, props: null, grass: null, terr: null, colliders: [], pois: [] };
      this.chunks.set(k, c);
    }
    if (c.step !== step) {
      if (step !== 1) this._dropProps(c);
      const t = buildTerrain(this.gen, cx, cz, step);
      this._replace(c, 'terrain', t.geometry && new THREE.Mesh(t.geometry, this.mat.terrain), true);
      this._replace(c, 'water', t.water && new THREE.Mesh(t.water, this.mat.water), false);
      if (c.water) c.water.renderOrder = 1;
      c.step = step;
      c.terr = step === 1 ? t : null;
    }
    if (wantProps && !c.props && c.terr) {
      const S = CHUNK_SIZE, x0 = cx * S, z0 = cz * S;
      const near = this.pois.near(x0, z0, x0 + S, z0 + S);
      const own = near.filter((p) => p.x >= x0 && p.x < x0 + S && p.z >= z0 && p.z < z0 + S);
      const b = new PropBuilder();
      const colliders = [];
      for (const p of own) buildPOI(b, this.gen, p, colliders);
      buildVegetation(b, this.gen, c.terr, cx, cz, near, colliders);
      const g = b.build();
      this._replace(c, 'props', g ? new THREE.Mesh(g, this.mat.props) : new THREE.Object3D(), true);
      c.colliders = colliders;
      c.pois = own;
      c.nearPois = near;
    }
    if (wantGrass && !c.grass && c.terr && c.nearPois) {
      const near = c.nearPois;
      const g = buildGrass(c.terr, cx, cz, this.q.grassSpacing, hash3i(cx, cz, 5, this.gen.seed),
        (x, z) => poiBlocks(near, x, z, -0.5));
      this._replace(c, 'grass', g ? new THREE.Mesh(g, this.mat.grass) : new THREE.Object3D(), false);
    }
  }

  _replace(c, field, obj, castShadow) {
    if (c[field]) this._dispose(c[field]);
    c[field] = obj || null;
    if (obj) {
      if (castShadow) obj.layers.enable(SHADOW_LAYER);
      this.group.add(obj);
    }
  }

  _dispose(obj) {
    this.group.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
  }

  _dropGrass(c) { if (c.grass) { this._dispose(c.grass); c.grass = null; } }

  _dropProps(c) {
    if (c.props) { this._dispose(c.props); c.props = null; }
    this._dropGrass(c);
    c.colliders = [];
    c.pois = [];
  }

  _unload(k, c) {
    for (const f of ['terrain', 'water', 'props', 'grass']) if (c[f]) this._dispose(c[f]);
    this.chunks.delete(k);
  }

  clear() {
    for (const [k, c] of this.chunks) this._unload(k, c);
  }

  // Colliders from the chunk at (x,z) and its neighbours
  collidersNear(x, z, out) {
    out.length = 0;
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(this.key(cx + dx, cz + dz));
        if (c) for (const col of c.colliders) out.push(col);
      }
    }
    return out;
  }

  poisNear(x, z) {
    const out = [];
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.chunks.get(this.key(cx + dx, cz + dz));
      if (c) out.push(...c.pois);
    }
    return out;
  }

  stats() {
    let tris = 0, meshes = 0;
    this.group.traverse((o) => {
      if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; }
    });
    return { chunks: this.chunks.size, meshes, tris: Math.round(tris) };
  }
}
