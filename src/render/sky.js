// Sky dome (gradient, sun, moon, stars, pixelated clouds) and the day/night cycle
// that drives every lighting uniform.

import * as THREE from 'three';
import { COMMON, env } from './texel.js';
import { clamp, smoothstep } from '../noise.js';

const skyUniforms = {
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uMoonDir: { value: new THREE.Vector3() },
  uSunPos: { value: new THREE.Vector3() },
  uSunDisc: { value: new THREE.Color() },
  uCloudLit: { value: new THREE.Color() },
  uCloudShade: { value: new THREE.Color() },
};

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FS = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uMoonDir;
uniform vec3 uSunPos;
uniform vec3 uSunDisc;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  // pixel-quantized direction keeps sky details in the same visual language
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.25, d.y));
  float sd = dot(d, uSunPos);
  col += uFogSunColor * pow(max(sd, 0.0), 8.0) * 0.35 * (1.0 - uNight);

  // stars
  vec3 sc = floor(d * 220.0);
  float star = step(0.9975, hash12(sc.xy + sc.z * 17.31)) * smoothstep(0.0, 0.2, d.y);
  col += vec3(0.9, 0.92, 1.0) * star * uNight * (0.6 + 0.4 * sin(uTime * 2.0 + sc.x));

  // sun & moon discs (hard-edged, slightly stepped)
  if (sd > 0.9992) col = uSunDisc;
  else if (sd > 0.998) col = mix(col, uSunDisc, 0.35);
  float md = dot(d, uMoonDir);
  if (md > 0.9993) col = mix(col, vec3(0.92, 0.93, 1.0), uNight * 0.95 + 0.15);

  // clouds: projected on a plane, sampled on a coarse grid -> visible pixel clusters
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
    vec2 cell = floor(uv * 42.0);
    vec2 c = cell / 42.0;
    float n = vnoise(c * 3.0) * 0.6 + vnoise(c * 7.0 + 3.1) * 0.3 + hash12(cell) * 0.1;
    float cov = n - 0.58;
    if (cov > 0.0) {
      float shade = vnoise(c * 7.0 + 3.1 + 0.08);
      vec3 cc = cov > 0.07 && shade < 0.55 ? uCloudShade : uCloudLit;
      float fade = smoothstep(0.02, 0.18, d.y);
      col = mix(col, cc, fade * (cov > 0.025 ? 0.95 : 0.6));
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky() {
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...env, ...skyUniforms },
    vertexShader: COMMON + SKY_VS,
    fragmentShader: COMMON + SKY_FS,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// Color keyframes by sun elevation
const C = (r, g, b) => new THREE.Color(r, g, b);
const KEYS = [
  { e: -0.4, zenith: C(0.03, 0.05, 0.13), horizon: C(0.1, 0.13, 0.25), light: C(0.3, 0.38, 0.6), lightI: 0.45, skyAmb: C(0.15, 0.19, 0.33), groundAmb: C(0.07, 0.07, 0.1), fogSun: C(0.12, 0.15, 0.27), cloudLit: C(0.16, 0.19, 0.3), cloudShade: C(0.09, 0.11, 0.2) },
  { e: -0.12, zenith: C(0.16, 0.18, 0.38), horizon: C(0.5, 0.38, 0.52), light: C(0.4, 0.4, 0.6), lightI: 0.2, skyAmb: C(0.25, 0.25, 0.4), groundAmb: C(0.12, 0.1, 0.14), fogSun: C(0.75, 0.45, 0.5), cloudLit: C(0.6, 0.42, 0.55), cloudShade: C(0.3, 0.26, 0.4) },
  { e: 0.0, zenith: C(0.3, 0.38, 0.65), horizon: C(0.98, 0.66, 0.55), light: C(1.0, 0.6, 0.4), lightI: 0.35, skyAmb: C(0.38, 0.36, 0.5), groundAmb: C(0.2, 0.15, 0.15), fogSun: C(1.0, 0.6, 0.4), cloudLit: C(1.0, 0.72, 0.6), cloudShade: C(0.55, 0.42, 0.55) },
  { e: 0.12, zenith: C(0.38, 0.56, 0.85), horizon: C(0.98, 0.82, 0.62), light: C(1.0, 0.82, 0.6), lightI: 1.0, skyAmb: C(0.4, 0.44, 0.58), groundAmb: C(0.28, 0.24, 0.2), fogSun: C(1.0, 0.78, 0.55), cloudLit: C(1.0, 0.92, 0.82), cloudShade: C(0.7, 0.68, 0.75) },
  { e: 0.35, zenith: C(0.33, 0.58, 0.92), horizon: C(0.74, 0.85, 0.94), light: C(1.0, 0.95, 0.86), lightI: 1.0, skyAmb: C(0.4, 0.47, 0.6), groundAmb: C(0.25, 0.24, 0.2), fogSun: C(0.95, 0.92, 0.84), cloudLit: C(1.0, 1.0, 0.98), cloudShade: C(0.76, 0.8, 0.88) },
  { e: 1.0, zenith: C(0.28, 0.55, 0.93), horizon: C(0.7, 0.83, 0.95), light: C(1.0, 0.97, 0.9), lightI: 1.05, skyAmb: C(0.42, 0.49, 0.62), groundAmb: C(0.26, 0.25, 0.21), fogSun: C(0.92, 0.92, 0.88), cloudLit: C(1.0, 1.0, 1.0), cloudShade: C(0.78, 0.82, 0.9) },
];

const _a = new THREE.Color(), _b = new THREE.Color();
function lerpKey(e, field, out) {
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const k0 = KEYS[i], k1 = KEYS[i + 1];
  const t = clamp((e - k0.e) / (k1.e - k0.e), 0, 1);
  if (typeof k0[field] === 'number') return k0[field] + (k1[field] - k0[field]) * t;
  _a.copy(k0[field]); _b.copy(k1[field]);
  return out.copy(_a).lerp(_b, t);
}

export class DayCycle {
  constructor() {
    this.sunDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.elevation = 0;
    this.fogFar = 330;
  }

  update(t) {
    const th = (t - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(th), Math.sin(th) * 0.92, 0.38).normalize();
    const e = this.sunDir.y;
    this.elevation = e;
    skyUniforms.uSunPos.value.copy(this.sunDir);
    const moon = skyUniforms.uMoonDir.value.set(-this.sunDir.x, -this.sunDir.y, 0.25).normalize();

    const night = smoothstep(0.02, -0.16, e);
    env.uNight.value = night;
    const useMoon = e < -0.05;
    this.lightDir.copy(useMoon ? moon : this.sunDir);
    // keep light slightly above the horizon so shadows stay readable
    if (this.lightDir.y < 0.12) { this.lightDir.y = 0.12; this.lightDir.normalize(); }
    env.uSunDir.value.copy(this.lightDir);

    const lightI = lerpKey(e, 'lightI') * (useMoon ? smoothstep(-0.05, -0.2, e) : smoothstep(-0.05, 0.03, e));
    lerpKey(e, 'light', env.uSunColor.value).multiplyScalar(lightI);
    lerpKey(e, 'skyAmb', env.uSkyAmb.value);
    lerpKey(e, 'groundAmb', env.uGroundAmb.value);
    lerpKey(e, 'horizon', env.uFogColor.value);
    lerpKey(e, 'fogSun', env.uFogSunColor.value);
    lerpKey(e, 'zenith', skyUniforms.uZenith.value);
    skyUniforms.uHorizon.value.copy(env.uFogColor.value);
    lerpKey(e, 'cloudLit', skyUniforms.uCloudLit.value);
    lerpKey(e, 'cloudShade', skyUniforms.uCloudShade.value);
    skyUniforms.uSunDisc.value.setRGB(1.0, 0.95, 0.8).lerp(_a.setRGB(1.0, 0.6, 0.35), smoothstep(0.25, 0.0, e));

    // Morning mist: fog pulls closer around sunrise
    const mist = Math.exp(-Math.pow((t - 0.27) / 0.035, 2));
    const far = this.fogFar;
    env.uFogRange.value.set(far * 0.22 - 40 * mist - 20 * night, far - 120 * mist - 60 * night);
    if (mist > 0.01) env.uFogColor.value.lerp(_a.setRGB(0.88, 0.86, 0.9), mist * 0.5);
  }
}
