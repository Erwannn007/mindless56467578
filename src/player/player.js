// First-person walker: acceleration, slopes, steps, collisions, gentle head motion.

import { EYE_HEIGHT, WATER_LEVEL } from '../config.js';

const RADIUS = 0.35;
const STEP = 0.5;
const WALK = 3.3, RUN = 6.2;
const MAX_CLIMB = 1.15;     // max rise per meter of horizontal travel (~49°)

export class Player {
  constructor(gen, chunks) {
    this.gen = gen;
    this.chunks = chunks;
    this.x = 0; this.z = 0; this.y = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.yaw = 0; this.pitch = 0;
    this.eyeY = 0;
    this.bob = 0;
    this.headBob = true;
    this._cols = [];
    this.speed = 0;
  }

  place(x, z, yaw = 0, pitch = 0) {
    this.x = x; this.z = z;
    this.yaw = yaw; this.pitch = pitch;
    this.vx = this.vz = this.vy = 0;
    this.y = this.groundAt(x, z, Infinity);
    this.eyeY = this.y + EYE_HEIGHT;
  }

  // Highest walkable surface under (x,z) not higher than maxY
  groundAt(x, z, maxY) {
    let g = this.gen.meshHeight(x, z);
    for (const c of this._cols) {
      if (c.y1 > maxY || c.y1 <= g) continue;
      if (inside(c, x, z, 0)) g = c.y1;
    }
    return g;
  }

  update(dt, input, camera) {
    const cols = this.chunks.collidersNear(this.x, this.z, this._cols);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = -Z rotated by yaw
    const fx = -sy, fz = -cy, rx = cy, rz = -sy;
    let mx = input.move.x, mz = input.move.y;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const inWater = this.y < WATER_LEVEL - 0.25;
    const speed = (input.run ? RUN : WALK) * (inWater ? 0.55 : 1);
    const tx = (fx * mz + rx * mx) * speed, tz = (fz * mz + rz * mx) * speed;
    const accel = ml > 0.01 ? 9 : 11;
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;

    // horizontal move with sub-steps for stability
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vz) * dt / 0.25));
    for (let s = 0; s < steps; s++) this._move(this.vx * dt / steps, this.vz * dt / steps, cols);

    // vertical: snap up steps, fall with gravity
    const ground = this.groundAt(this.x, this.z, this.y + STEP);
    if (ground >= this.y - 0.05) { this.y = ground; this.vy = 0; }
    else {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      if (this.y < ground) { this.y = ground; this.vy = 0; }
      // stick to gentle downhill slopes instead of hopping
      if (this.y - ground < 0.35 && this.vy > -3) { this.y = ground; this.vy = 0; }
    }

    // camera: smooth only the eye height (steps), never the look direction
    this.speed = Math.hypot(this.vx, this.vz);
    const targetEye = this.y + EYE_HEIGHT;
    this.eyeY += (targetEye - this.eyeY) * (1 - Math.exp(-dt * (targetEye > this.eyeY ? 14 : 22)));
    if (Math.abs(targetEye - this.eyeY) > 2) this.eyeY = targetEye;
    let bobY = 0;
    if (this.headBob) {
      this.bob += dt * this.speed * 1.9;
      const amt = Math.min(1, this.speed / WALK);
      bobY = Math.sin(this.bob * 2) * 0.022 * amt;
    }
    camera.position.set(this.x, this.eyeY + bobY, this.z);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  _move(dx, dz, cols) {
    let nx = this.x + dx, nz = this.z + dz;
    // slope / deep water check
    const g0 = this.gen.meshHeight(this.x, this.z);
    const g1 = this.gen.meshHeight(nx, nz);
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-5) {
      const climbing = g1 - g0;
      if ((climbing > 0 && climbing / dist > MAX_CLIMB) || g1 < WATER_LEVEL - 1.2) {
        // slide along the contour instead of stopping dead
        const n = this.gen.normalAt(nx, nz, 0.5);
        const hx = n[0], hz = n[2];
        const hl = Math.hypot(hx, hz) || 1;
        const ux = hx / hl, uz = hz / hl;
        const dot = dx * ux + dz * uz;
        if (dot < 0 || g1 < WATER_LEVEL - 1.2) {
          const sx = dx - ux * Math.min(dot, 0), sz = dz - uz * Math.min(dot, 0);
          const gs = this.gen.meshHeight(this.x + sx, this.z + sz);
          if (gs < WATER_LEVEL - 1.2 || (gs - g0) / Math.max(Math.hypot(sx, sz), 1e-5) > MAX_CLIMB) return;
          nx = this.x + sx; nz = this.z + sz;
        }
      }
    }
    // obstacles: push out of every collider the body overlaps
    const feet = this.y, head = this.y + 1.75;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of cols) {
        if (c.y1 <= feet + STEP || c.y0 >= head) continue;
        const p = pushOut(c, nx, nz, RADIUS);
        if (p) { nx = p[0]; nz = p[1]; }
      }
    }
    this.x = nx; this.z = nz;
  }
}

function inside(c, x, z, r) {
  if (c.kind === 'circle') {
    const dx = x - c.x, dz = z - c.z, rr = c.r + r;
    return dx * dx + dz * dz < rr * rr;
  }
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
  const dx = x - c.x, dz = z - c.z;
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  return Math.abs(lx) < c.hx + r && Math.abs(lz) < c.hz + r;
}

function pushOut(c, x, z, r) {
  if (c.kind === 'circle') {
    const dx = x - c.x, dz = z - c.z, rr = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2) || 1e-4;
    return [c.x + (dx / d) * rr, c.z + (dz / d) * rr];
  }
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
  const dx = x - c.x, dz = z - c.z;
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  // closest point on the box to the circle center
  const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
  let ex = lx - qx, ez = lz - qz;
  let d2 = ex * ex + ez * ez;
  let ox, oz;
  if (d2 > 1e-10) {
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    ox = qx + (ex / d) * r; oz = qz + (ez / d) * r;
  } else {
    // center inside the box: exit through the nearest face
    const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
    if (px < pz) { ox = Math.sign(lx || 1) * (c.hx + r); oz = lz; }
    else { ox = lx; oz = Math.sign(lz || 1) * (c.hz + r); }
  }
  // back to world (inverse of the rotation above)
  return [c.x + ox * cs + oz * sn, c.z - ox * sn + oz * cs];
}
