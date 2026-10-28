// Shared base geometries for props (built once, copied into chunk meshes).

import * as THREE from 'three';
import { createSimplex } from '../noise.js';

const n3 = createSimplex(1234);

function displace(geom, amount, freq, seed, flat) {
  const p = geom.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = v.clone().normalize();
    const k = 1 + amount * (n3(d.x * freq + seed, d.y * freq - seed) * 0.6 + n3(d.z * freq - seed, d.x * freq + d.y) * 0.4);
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  if (flat) geom.computeVertexNormals();
  return geom;
}

export const SHAPES = (() => {
  const trunk = new THREE.CylinderGeometry(0.62, 1, 1, 6, 2, true).translate(0, 0.5, 0);
  const blobs = [0, 1, 2].map((s) => displace(new THREE.IcosahedronGeometry(1, 1), 0.22, 1.7, s * 3.1, false));
  const smallBlob = displace(new THREE.IcosahedronGeometry(1, 0), 0.15, 1.5, 9.1, false);
  const cone = new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0);
  const rocks = [0, 1, 2].map((s) => displace(new THREE.IcosahedronGeometry(1, s === 0 ? 0 : 1).toNonIndexed(), 0.35, 1.3, s * 5.7 + 1, true));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const boxBase = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const petal = new THREE.OctahedronGeometry(1, 0);
  const cap = new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  const stem = new THREE.CylinderGeometry(0.7, 1, 1, 5, 1, true).translate(0, 0.5, 0);
  const log = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false).rotateZ(Math.PI / 2);
  // gable roof prism: ridge along X, base width 1 (z from -0.5 to 0.5), height 1
  const prism = new THREE.BufferGeometry();
  {
    const P = [
      // left slope
      -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
      // right slope
      0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
      // gables
      -0.5, 0, 0.5, -0.5, 1, 0, -0.5, 0, -0.5,
      0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, 0.5,
    ];
    prism.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    prism.computeVertexNormals();
  }
  return { trunk, blobs, smallBlob, cone, rocks, box, boxBase, petal, cap, stem, log, prism };
})();
