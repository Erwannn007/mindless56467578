// Night fireflies: a small cloud of pixel-square lights that wraps around the player.

import * as THREE from 'three';
import { COMMON, env } from './texel.js';

const COUNT = 90;
const R = 22;

export function createFireflies() {
  const pos = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = Math.random() * R * 2;
    pos[i * 3 + 1] = 0.4 + Math.random() * 2.2;
    pos[i * 3 + 2] = Math.random() * R * 2;
    seed[i] = Math.random() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { ...env, uGround: { value: 0 }, uScale: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: COMMON + /* glsl */ `
      attribute float aSeed;
      uniform float uGround;
      uniform float uScale;
      varying float vA;
      void main() {
        vec3 p = position;
        p.xz = mod(p.xz - cameraPosition.xz + ${R.toFixed(1)}, ${(R * 2).toFixed(1)}) + cameraPosition.xz - ${R.toFixed(1)};
        p.x += sin(uTime * 0.5 + aSeed) * 0.8;
        p.z += cos(uTime * 0.4 + aSeed * 1.3) * 0.8;
        p.y += uGround + sin(uTime * 0.7 + aSeed * 2.1) * 0.4;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float blink = smoothstep(0.2, 0.9, sin(uTime * 1.3 + aSeed * 5.0) * 0.5 + 0.5);
        vA = uNight * blink;
        gl_PointSize = uScale * clamp(30.0 / -mv.z, 1.0, 4.0);
      }`,
    fragmentShader: COMMON + /* glsl */ `
      varying float vA;
      void main() {
        if (vA < 0.02) discard;
        gl_FragColor = vec4(vec3(0.95, 1.0, 0.55) * vA, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.userData.uniforms = uniforms;
  return pts;
}
