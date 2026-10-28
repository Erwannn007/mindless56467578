// Accumulates many small primitives into one BufferGeometry (one draw call per chunk).

import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class PropBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.mat = []; this.col = []; this.wind = []; this.idx = [];
    this.count = 0;
  }

  // geom: a THREE.BufferGeometry (indexed or not). opts: { mat, color:[r,g,b], ao, wind, aoFn }
  add(geom, matrix, opts) {
    const p = geom.attributes.position, n = geom.attributes.normal;
    _nm.getNormalMatrix(matrix);
    const base = this.count;
    const c = opts.color || [1, 1, 1];
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      this.pos.push(_v.x, _v.y, _v.z);
      this.nrm.push(_n.x, _n.y, _n.z);
      this.mat.push(opts.mat);
      const ao = opts.aoFn ? opts.aoFn(_n, _v) : (opts.ao ?? 1);
      this.col.push(c[0], c[1], c[2], ao);
      this.wind.push(opts.wind || 0);
    }
    if (geom.index) {
      const ix = geom.index.array;
      for (let i = 0; i < ix.length; i++) this.idx.push(base + ix[i]);
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
    this.count += p.count;
  }

  // Convenience: transform from position / Y rotation / scale (+ optional tilt)
  addAt(geom, x, y, z, rotY, sx, sy, sz, opts, tiltX = 0, tiltZ = 0) {
    _e.set(tiltX, rotY, tiltZ, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.add(geom, _m, opts);
  }

  build() {
    if (this.count === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 4));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 1));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
