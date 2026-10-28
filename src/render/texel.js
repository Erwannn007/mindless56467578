// Texel-splatting material system.
//
// Every surface in Éverlune is shaded through the same idea: the fragment is snapped
// to a world-space texel grid (on the plane facing the dominant normal axis), and all
// inputs (normal, material weights, shadow lookup) are re-evaluated at the texel center.
// Each texel therefore receives one flat color and one flat lighting value, producing
// stable "true 3D pixel art" surfaces with no texture images and no shimmering.

import * as THREE from 'three';
import { WATER_LEVEL } from '../config.js';

// Shared uniforms: updated once per frame, seen by every material.
export const env = {
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uSkyAmb: { value: new THREE.Color(0.45, 0.55, 0.7) },
  uGroundAmb: { value: new THREE.Color(0.3, 0.28, 0.22) },
  uFogColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
  uFogSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
  uFogRange: { value: new THREE.Vector2(70, 300) },
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uShadowTexel: { value: 1 / 1024 },
  uTime: { value: 0 },
  uNight: { value: 0 },
  uGrassFade: { value: new THREE.Vector2(18, 30) },
};

export const COMMON = /* glsl */ `
precision highp float;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec2 uFogRange;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform float uShadowTexel;
uniform float uTime;
uniform float uNight;
#define WATER_LEVEL ${WATER_LEVEL.toFixed(2)}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

const FRAG_COMMON = /* glsl */ `
// Snap p onto a world texel grid of density D (texels / meter) on the plane facing n.
// cell: integer texel coords (+ per-axis offset), sp: texel center projected on the surface,
// ab: screen-space offset to reach the texel center (to re-evaluate varyings there),
// fp: texel footprint in texels per pixel (for distance filtering).
void texelSnap(vec3 p, vec3 n, float D, out vec2 cell, out vec3 sp, out vec2 ab, out float fp) {
  vec3 an = abs(n);
  vec3 q = p * D;
  vec3 c;
  if (an.y >= an.x && an.y >= an.z) {
    cell = floor(q.xz);
    c.xz = cell + 0.5;
    c.y = q.y + (n.x * (q.x - c.x) + n.z * (q.z - c.z)) / n.y;
  } else if (an.x >= an.z) {
    vec2 k = floor(q.zy);
    c.zy = k + 0.5;
    c.x = q.x + (n.y * (q.y - c.y) + n.z * (q.z - c.z)) / n.x;
    cell = k + vec2(0.37, 0.71) * 97.0;
  } else {
    vec2 k = floor(q.xy);
    c.xy = k + 0.5;
    c.z = q.z + (n.x * (q.x - c.x) + n.y * (q.y - c.y)) / n.z;
    cell = k + vec2(0.83, 0.19) * 131.0;
  }
  sp = c / D;
  vec3 d = sp - p;
  vec3 dx = dFdx(p), dy = dFdy(p);
  float a11 = dot(dx, dx), a12 = dot(dx, dy), a22 = dot(dy, dy);
  float det = a11 * a22 - a12 * a12;
  ab = det > 1e-5 * a11 * a22 ? vec2(a22 * dot(dx, d) - a12 * dot(dy, d), a11 * dot(dy, d) - a12 * dot(dx, d)) / det : vec2(0.0);
  ab = clamp(ab, vec2(-48.0), vec2(48.0));
  fp = sqrt(max(a11, a22)) * D;
}

float sunShadow(vec3 sp, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(sp + n * 0.06, 1.0);
  vec3 c = sc.xyz * 0.5 + 0.5;
  vec2 e = abs(c.xy - 0.5) * 2.0;
  float edge = smoothstep(0.85, 0.98, max(e.x, e.y));
  if (edge >= 1.0 || c.z > 1.0) return 1.0;
  float d = texture2D(uShadowMap, c.xy).r;
  float s = c.z - 0.0012 > d ? 0.0 : 1.0;
  return mix(s, 1.0, edge);
}

// One flat light value per texel, softly posterized with a per-texel dither.
vec3 lightTexel(vec3 albedo, vec3 n, vec3 sp, vec2 cell, float ao) {
  float ndl = dot(n, uSunDir);
  float dif = ndl > 0.0 ? ndl * sunShadow(sp, n) : 0.0;
  dif = floor(dif * 6.0 + 0.35 + 0.3 * hash12(cell + 17.3)) / 6.0;
  vec3 amb = mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5) * ao;
  return albedo * (amb + uSunColor * dif);
}

vec3 applyFog(vec3 col, vec3 wp) {
  vec3 v = wp - cameraPosition;
  float d = length(v);
  float f = smoothstep(uFogRange.x, uFogRange.y, d);
  float s = pow(max(dot(v / max(d, 1e-3), uSunDir), 0.0), 5.0);
  return mix(col, mix(uFogColor, uFogSunColor, s), f);
}

vec3 pick4(float v, vec3 a, vec3 b, vec3 c, vec3 d, vec3 t) {
  return v < t.x ? a : v < t.y ? b : v < t.z ? c : d;
}

// ---- Material palettes -------------------------------------------------
vec3 grassColor(vec2 cell, float detail, float moist, float forest) {
  float v = vnoise(cell * 0.23 + 3.1) * 0.65 + hash12(cell) * 0.35;
  float pch = vnoise(cell * 0.045 - 7.7);
  v = mix(0.5, v + (pch - 0.5) * 0.35, detail);
  vec3 c = pick4(v,
    vec3(0.27, 0.43, 0.2), vec3(0.37, 0.54, 0.24),
    vec3(0.48, 0.63, 0.27), vec3(0.62, 0.69, 0.32), vec3(0.3, 0.6, 0.84));
  vec3 dry = c * vec3(1.12, 1.0, 0.72) + vec3(0.06, 0.03, 0.0);
  c = mix(dry, c, smoothstep(0.15, 0.6, moist));
  c = mix(c, c * vec3(0.78, 0.9, 0.85), smoothstep(0.0, 0.6, forest) * 0.6);
  return c;
}
vec3 dirtColor(vec2 cell, float detail) {
  float v = mix(0.5, vnoise(cell * 0.3 + 9.2) * 0.6 + hash12(cell + 4.1) * 0.4, detail);
  vec3 c = pick4(v, vec3(0.42, 0.31, 0.2), vec3(0.53, 0.4, 0.26), vec3(0.62, 0.48, 0.32), vec3(0.72, 0.59, 0.42), vec3(0.25, 0.6, 0.88));
  return c;
}
vec3 sandColor(vec2 cell, float detail) {
  float v = mix(0.5, vnoise(cell * 0.27 + 1.7) * 0.5 + hash12(cell + 2.2) * 0.5, detail);
  return pick4(v, vec3(0.7, 0.62, 0.45), vec3(0.79, 0.71, 0.52), vec3(0.85, 0.78, 0.59), vec3(0.91, 0.85, 0.68), vec3(0.2, 0.55, 0.85));
}
vec3 stoneColor(vec2 cell, float detail) {
  float v = vnoise(cell * 0.1 + 5.5) * 0.62 + vnoise(cell * 0.33 - 2.0) * 0.26 + hash12(cell + 6.6) * 0.12;
  v = mix(0.5, v, detail);
  vec3 c = pick4(v, vec3(0.45, 0.43, 0.4), vec3(0.58, 0.55, 0.5), vec3(0.69, 0.65, 0.57), vec3(0.79, 0.75, 0.65), vec3(0.22, 0.5, 0.8));
  float crack = step(0.93, hash12(cell + 3.3)) * detail;
  return mix(c, c * 0.72, crack);
}
`;

// ---------------------------------------------------------------------------
// Terrain

const TERRAIN_VS = /* glsl */ `
attribute vec4 aSplat;   // grass, dirt, sand, rock
attribute vec2 aExtra;   // moisture, forest
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vSplat;
varying vec2 vExtra;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normal;
  vSplat = aSplat;
  vExtra = aExtra;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TERRAIN_FS = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vSplat;
varying vec2 vExtra;
void main() {
  vec3 n = normalize(vNormal);
  vec2 cell; vec3 sp; vec2 ab; float fp;
  texelSnap(vWorld, n, 8.0, cell, sp, ab, fp);
  vec3 ns = normalize(vNormal + ab.x * dFdx(vNormal) + ab.y * dFdy(vNormal));
  vec4 w = vSplat + ab.x * dFdx(vSplat) + ab.y * dFdy(vSplat);
  vec2 ex = vExtra + ab.x * dFdx(vExtra) + ab.y * dFdy(vExtra);
  float detail = 1.0 - smoothstep(0.45, 1.3, fp);

  // Irregular, pixelated material borders: jitter weights per texel and per cluster.
  vec4 jit = vec4(hash12(cell + 1.3), hash12(cell + 2.9), hash12(cell + 5.1), hash12(cell + 8.3)) - 0.5;
  vec4 clus = vec4(vnoise(cell * 0.25 + 11.0), vnoise(cell * 0.21 + 21.0), vnoise(cell * 0.19 + 31.0), vnoise(cell * 0.12 + 41.0)) - 0.5;
  w += (jit * 0.38 + clus * 0.6) * mix(0.15, 1.0, detail);

  // rock gets coarser texels, like the chunky stone of the reference
  // (computed outside branches so screen-space derivatives stay valid)
  vec2 rc; vec3 rsp; vec2 rab; float rfp;
  texelSnap(vWorld, n, 4.0, rc, rsp, rab, rfp);
  vec3 rns = normalize(vNormal + rab.x * dFdx(vNormal) + rab.y * dFdy(vNormal));
  float rdetail = 1.0 - smoothstep(0.45, 1.3, rfp);

  vec3 col;
  float ao = 1.0 - smoothstep(0.1, 0.8, ex.y) * 0.25;
  if (w.w > w.x && w.w > w.y && w.w > w.z) {
    col = stoneColor(rc, rdetail);
    if (ns.y > 0.75 && vnoise(cell * 0.2) > 0.55) col = grassColor(cell, detail, ex.x, ex.y) * 0.85;
    else { cell = rc; sp = rsp; ns = rns; }
  } else if (w.y > w.x && w.y > w.z) {
    col = dirtColor(cell, detail);
  } else if (w.z > w.x) {
    col = sandColor(cell, detail);
    col *= 1.0 - 0.18 * (1.0 - smoothstep(WATER_LEVEL, WATER_LEVEL + 0.5, sp.y));
  } else {
    col = grassColor(cell, detail, ex.x, ex.y);
    // tiny pixel flowers in open meadows
    float fl = hash12(cell + 77.7);
    float meadow = smoothstep(0.35, 0.8, ex.x) * (1.0 - smoothstep(-0.2, 0.3, ex.y));
    if (detail > 0.5 && fl > 1.0 - 0.006 * meadow) {
      float k = hash12(cell + 3.7);
      col = k < 0.3 ? vec3(0.95, 0.93, 0.85) : k < 0.55 ? vec3(0.98, 0.85, 0.35) : k < 0.8 ? vec3(0.93, 0.62, 0.72) : vec3(0.72, 0.64, 0.92);
    }
  }
  col *= 0.95 + 0.1 * hash12(cell + 0.5) * detail;

  vec3 lit = lightTexel(col, ns, sp, cell, ao);
  // underwater tint
  float under = smoothstep(0.0, 3.0, WATER_LEVEL - sp.y);
  lit = mix(lit, vec3(0.12, 0.3, 0.38) * (uSkyAmb + uSunColor * 0.5), under * 0.7);
  gl_FragColor = vec4(applyFog(lit, vWorld), 1.0);
}
`;

// ---------------------------------------------------------------------------
// Props: trees, rocks, ruins, cabins... one shader, material id per vertex.

const PROPS_VS = /* glsl */ `
attribute float aMat;
attribute vec4 aColor;  // rgb tint, a = ambient occlusion
attribute float aWind;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying float vMat;
void main() {
  vec3 p = position;
  if (aWind > 0.0) {
    float t = uTime * 1.3 + p.x * 0.21 + p.z * 0.17;
    p.x += sin(t) * 0.05 * aWind;
    p.z += cos(t * 0.8) * 0.04 * aWind;
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormal = normal;
  vColor = aColor;
  vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PROPS_FS = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying float vMat;
void main() {
  int m = int(vMat + 0.5);
  vec3 n = normalize(vNormal);
  float D = m == 2 ? 7.0 : m == 1 ? 9.0 : 11.0;
  vec2 cell; vec3 sp; vec2 ab; float fp;
  texelSnap(vWorld, n, D, cell, sp, ab, fp);
  vec3 ns = normalize(vNormal + ab.x * dFdx(vNormal) + ab.y * dFdy(vNormal));
  float ao = vColor.a + ab.x * dFdx(vColor.a) + ab.y * dFdy(vColor.a);
  float detail = 1.0 - smoothstep(0.45, 1.3, fp);
  float h = hash12(cell);
  vec3 col;
  if (m == 0) { // bark: vertical streaks
    float v = mix(0.5, vnoise(cell * vec2(0.6, 0.12)) * 0.7 + h * 0.3, detail);
    col = pick4(v, vec3(0.3, 0.21, 0.14), vec3(0.4, 0.29, 0.19), vec3(0.48, 0.36, 0.24), vec3(0.56, 0.44, 0.3), vec3(0.25, 0.55, 0.85));
  } else if (m == 1) { // leaves
    float v = mix(0.5, vnoise(cell * 0.3) * 0.6 + h * 0.4, detail);
    col = pick4(v, vec3(0.2, 0.36, 0.16), vec3(0.29, 0.48, 0.2), vec3(0.4, 0.6, 0.24), vec3(0.55, 0.7, 0.3), vec3(0.22, 0.55, 0.85));
  } else if (m == 2) { // stone
    col = stoneColor(cell, detail);
    float moss = smoothstep(0.35, 0.9, ns.y) * step(0.45, vnoise(cell * 0.18 + 2.0));
    if (moss > 0.5) col = grassColor(cell, detail, 0.7, 0.3) * 0.9;
  } else if (m == 3) { // wood planks
    float row = mod(floor(cell.y), 5.0);
    float v = mix(0.5, vnoise(cell * vec2(0.12, 0.9)) * 0.6 + h * 0.4, detail);
    col = pick4(v, vec3(0.42, 0.29, 0.18), vec3(0.52, 0.37, 0.23), vec3(0.6, 0.44, 0.28), vec3(0.68, 0.52, 0.34), vec3(0.25, 0.55, 0.85));
    if (row < 0.5 && detail > 0.3) col *= 0.7;
  } else if (m == 4) { // roof shingles
    float row = mod(floor(cell.y + floor(cell.x * 0.5) * 0.0), 3.0);
    float v = mix(0.5, h, detail);
    col = pick4(v, vec3(0.38, 0.2, 0.17), vec3(0.47, 0.25, 0.2), vec3(0.55, 0.3, 0.22), vec3(0.62, 0.36, 0.26), vec3(0.25, 0.55, 0.85));
    if (row < 0.5 && detail > 0.3) col *= 0.75;
  } else if (m == 6) { // glow (windows, lanterns, luminous flowers)
    vec3 c = vColor.rgb * (0.55 + 0.9 * uNight) * (0.9 + 0.2 * h);
    gl_FragColor = vec4(applyFog(c, vWorld), 1.0);
    return;
  } else { // flat painted (petals, mushrooms, cloth)
    col = vec3(1.0);
  }
  col *= vColor.rgb * (0.94 + 0.12 * h * detail);
  vec3 lit = lightTexel(col, ns, sp, cell, clamp(ao, 0.0, 1.0));
  gl_FragColor = vec4(applyFog(lit, vWorld), 1.0);
}
`;

// ---------------------------------------------------------------------------
// Grass blades: thin triangles colored by the ground texel they grow from.

const GRASS_VS = /* glsl */ `
attribute vec3 aBase;
attribute vec3 aInfo;   // tip factor, moisture, forest
uniform vec2 uGrassFade;
varying vec3 vWorld;
varying vec3 vBase;
varying vec3 vInfo;
void main() {
  float d = distance(aBase.xz, cameraPosition.xz);
  float s = 1.0 - smoothstep(uGrassFade.x, uGrassFade.y, d);
  vec3 p = aBase + (position - aBase) * s;
  float t = uTime * 1.6 + aBase.x * 0.3 + aBase.z * 0.23;
  float sway = (sin(t) * 0.6 + sin(t * 2.3 + 1.7) * 0.25 + 0.5) * aInfo.x * aInfo.x * s;
  p.x += sway * 0.12;
  p.z += sway * 0.05;
  vWorld = p;
  vBase = aBase;
  vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const GRASS_FS = /* glsl */ `
varying vec3 vWorld;
varying vec3 vBase;
varying vec3 vInfo;
void main() {
  vec2 cell = floor(vBase.xz * 8.0);
  vec3 col = grassColor(cell, 1.0, vInfo.y, vInfo.z);
  float tip = floor(vInfo.x * 3.0) / 3.0;
  col *= 0.78 + 0.38 * tip;
  vec3 sp = vec3((cell + 0.5) / 8.0, vBase.y).xzy;
  vec3 lit = lightTexel(col, vec3(0.0, 1.0, 0.0), sp, cell, 0.95 - 0.2 * smoothstep(0.1, 0.8, vInfo.z));
  gl_FragColor = vec4(applyFog(lit, vWorld), 1.0);
}
`;

// ---------------------------------------------------------------------------
// Water: pixelated ripples, depth-based color and shoreline foam.

const WATER_VS = /* glsl */ `
attribute float aDepth;
varying vec3 vWorld;
varying float vDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vDepth = aDepth;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FS = /* glsl */ `
varying vec3 vWorld;
varying float vDepth;
void main() {
  vec2 cell = floor(vWorld.xz * 6.0);
  vec2 c = cell + 0.5;
  float fp = length(fwidth(vWorld.xz * 6.0));
  float detail = 1.0 - smoothstep(0.5, 1.4, fp);
  float t = floor(uTime * 6.0) / 6.0;
  float w = vnoise(c * 0.11 + vec2(t * 0.5, t * 0.21)) * 0.6 + vnoise(c * 0.23 - vec2(t * 0.37, -t * 0.4)) * 0.4;
  w = mix(0.5, w, detail);
  float depth = vDepth;
  vec3 deep = vec3(0.1, 0.3, 0.42), shallow = vec3(0.24, 0.55, 0.6);
  vec3 col = mix(shallow, deep, smoothstep(0.2, 3.0, depth));
  col = w < 0.35 ? col * 0.88 : w > 0.68 ? mix(col, vec3(0.6, 0.8, 0.85), 0.35) : col;
  vec3 v = normalize(vWorld - cameraPosition);
  vec3 wn = normalize(vec3((w - 0.5) * 0.25, 1.0, (vnoise(c * 0.17 + t) - 0.5) * 0.25));
  vec3 r = reflect(v, wn);
  float fres = pow(1.0 - max(dot(-v, wn), 0.0), 3.0);
  vec3 sky = mix(uFogColor, uSkyAmb * 1.4, 0.4);
  col = mix(col * (uSkyAmb + uSunColor * 0.75), sky, fres * 0.6);
  float glint = step(0.985 - 0.01 * hash12(cell), max(dot(r, uSunDir), 0.0));
  col += uSunColor * glint * 0.8 * detail * step(0.0, uSunDir.y);
  float foam = step(depth, 0.18 + 0.12 * vnoise(c * 0.4 + t));
  col = mix(col, vec3(0.9, 0.95, 0.95) * (uSkyAmb + uSunColor * 0.8), foam * 0.85);
  float alpha = mix(0.45, 0.9, smoothstep(0.0, 2.5, depth));
  alpha = max(alpha, foam * 0.9);
  gl_FragColor = vec4(applyFog(col, vWorld), alpha);
}
`;

function make(vs, fs, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...env },
    vertexShader: COMMON + vs,
    fragmentShader: COMMON + FRAG_COMMON + fs,
    ...extra,
  });
}

export function createMaterials() {
  return {
    terrain: make(TERRAIN_VS, TERRAIN_FS),
    props: make(PROPS_VS, PROPS_FS),
    grass: make(GRASS_VS, GRASS_FS, { side: THREE.DoubleSide }),
    water: make(WATER_VS, WATER_FS, { transparent: true, depthWrite: false }),
  };
}

export const MAT = { BARK: 0, LEAVES: 1, STONE: 2, WOOD: 3, ROOF: 4, PAINT: 5, GLOW: 6 };
