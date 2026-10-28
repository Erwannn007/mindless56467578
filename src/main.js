// Éverlune — bootstrap and main loop.

import * as THREE from 'three';
import { QUALITY, loadSettings, saveSettings, isTouch } from './config.js';
import { WorldGen } from './world/worldgen.js';
import { ChunkManager } from './world/chunks.js';
import { createMaterials, env } from './render/texel.js';
import { createSky, DayCycle } from './render/sky.js';
import { ShadowPass } from './render/shadows.js';
import { createFireflies } from './render/fireflies.js';
import { Player } from './player/player.js';
import { Input } from './player/input.js';
import { UI } from './ui/ui.js';

const settings = loadSettings();
if (isTouch) document.body.classList.add('touch');

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x1b2433);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 900);
camera.rotation.order = 'YXZ';

const materials = createMaterials();
const sky = createSky();
scene.add(sky);
const fireflies = createFireflies();
scene.add(fireflies);
const day = new DayCycle();

let quality = QUALITY[settings.quality] || QUALITY.medium;
const shadows = new ShadowPass(quality.shadowSize, quality.shadowExtent);

let gen, chunks, player;
const input = new Input(canvas, document.getElementById('touch-layer'), null);

function createWorld(seed) {
  if (chunks) { chunks.clear(); scene.remove(chunks.group); }
  gen = new WorldGen(seed);
  chunks = new ChunkManager(scene, gen, materials, quality);
  player = new Player(gen, chunks);
  input.player = player;
  const saved = settings.player && settings.player.seed === seed ? settings.player : null;
  if (saved) player.place(saved.x, saved.z, saved.yaw, saved.pitch);
  else {
    const sp = gen.findSpawn(0, 0);
    player.place(sp.x, sp.z, Math.PI * 0.25, -0.05);
  }
  applySettings();
}

function applySettings() {
  input.sensitivity = settings.sensitivity;
  if (player) player.headBob = settings.headBob !== false;
}

function applyQuality() {
  quality = QUALITY[settings.quality] || QUALITY.medium;
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatio));
  shadows.setSize(quality.shadowSize, quality.shadowExtent);
  day.fogFar = Math.min(330, quality.farRadius * 32 - 16);
  if (chunks) chunks.setQuality(quality);
  resize();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep a natural horizontal field of view in portrait
  camera.fov = w < h ? 85 : 72;
  camera.updateProjectionMatrix();
  fireflies.userData.uniforms.uScale.value = renderer.getPixelRatio();
}
addEventListener('resize', resize);

// --- state -----------------------------------------------------------------
let running = false;
let started = false;

const ui = new UI(settings, {
  start() {
    started = true;
    resume();
  },
  pause,
  resume,
  setRun(on) { input.runToggle = on; },
  applySettings,
  applyQuality() { applyQuality(); saveSettings(settings); },
  newWorld(seed) {
    settings.seed = seed;
    settings.player = null;
    settings.discovered = [];
    createWorld(seed);
    preload().then(() => saveSettings(settings));
  },
});

function pause() {
  if (!started) return;
  running = false;
  input.enabled = false;
  input.releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  savePlayer();
  ui.showMenu(settings.discovered.length);
}

function resume() {
  running = true;
  input.enabled = true;
  ui.showGame();
  if (!isTouch) canvas.requestPointerLock?.();
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && running && !isTouch) pause();
});
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && started && !running) resume();
  else if ((e.code === 'Escape' || e.code === 'KeyM') && running) pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (running) pause(); savePlayer(); }
});

function savePlayer() {
  if (!player) return;
  settings.player = { seed: settings.seed, x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch };
  saveSettings(settings);
}

// Build the world around the player before letting them in
function preload() {
  return new Promise((resolve) => {
    const tick = () => {
      const left = chunks.update(player.x, player.z, 40);
      const near = [...chunks.chunks.values()].filter((c) => c.props).length;
      ui.loading(`Le monde se dessine… ${near}`);
      if (left > 0 && near < 25) setTimeout(tick, 0);
      else { player.place(player.x, player.z, player.yaw, player.pitch); resolve(); }
    };
    tick();
  });
}

// --- loop --------------------------------------------------------------------
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, fps = 0, statT = 0, discT = 0, saveT = 0;
const shadowCenter = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (running) settings.timeOfDay = (settings.timeOfDay + dt / (settings.dayLength * 60)) % 1;
  env.uTime.value += dt;
  day.update(settings.timeOfDay);

  input.update();
  if (running) player.update(dt, input, camera);
  else {
    if (!started) player.yaw += dt * 0.05;
    player.update(0, { move: { x: 0, y: 0 }, run: false }, camera);
  }

  chunks.update(player.x, player.z, running ? 5 : 12);

  sky.position.copy(camera.position);
  fireflies.userData.uniforms.uGround.value = player.y;

  const look = Math.sin(player.yaw), lookZ = Math.cos(player.yaw);
  shadowCenter.set(player.x - look * quality.shadowExtent * 0.45, player.y, player.z - lookZ * quality.shadowExtent * 0.45);
  shadows.render(renderer, scene, shadowCenter, env.uSunDir.value);
  renderer.render(scene, camera);

  // discoveries
  discT += dt;
  if (running && discT > 0.5) {
    discT = 0;
    for (const p of chunks.poisNear(player.x, player.z)) {
      if (Math.hypot(p.x - player.x, p.z - player.z) < p.radius + 5 && !settings.discovered.includes(p.id)) {
        settings.discovered.push(p.id);
        ui.toast(`✦ ${p.name}`);
        saveSettings(settings);
      }
    }
  }
  saveT += dt;
  if (running && saveT > 5) { saveT = 0; savePlayer(); }

  // perf readout
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
  statT += dt;
  if (settings.showStats && statT > 0.5) {
    statT = 0;
    const st = chunks.stats();
    ui.stats(`${fps.toFixed(0)} fps · ${renderer.info.render.calls} draws · ${(st.tris / 1000).toFixed(0)}k tris · ${st.chunks} chunks`);
  }
}

// --- boot --------------------------------------------------------------------
applyQuality();
createWorld(settings.seed);
document.getElementById('stats').hidden = !settings.showStats;
requestAnimationFrame(frame);
preload().then(() => ui.ready());

// offline support when served over http(s)
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// debug hooks for development
window.everlune = { settings, env, shadows, get player() { return player; }, get chunks() { return chunks; }, renderer, camera, scene };
