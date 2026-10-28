// Procedural soundscape (Web Audio only, no sound files):
// wind, leaves, streams, waves, footsteps per surface, birds, insects, frogs, owl, soft generative music.

import { createSimplex, mulberry32, clamp, smoothstep } from '../noise.js';
import { WATER_LEVEL } from '../config.js';

function makeNoise(ctx, kind, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else { // pink (Paul Kellet, economy)
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
      }
    }
  }
  return buf;
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Music: slow pad progression in D major pentatonic colours
const CHORDS = [[50, 57, 64, 69], [47, 54, 62, 66], [52, 59, 64, 71], [45, 52, 57, 64], [43, 50, 59, 62]];
const MELODY = [62, 64, 66, 69, 71, 74, 76, 78, 81];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.musicVolume = 0.4;
    this.paused = true;
    this.slowT = 0;
    this.scanT = 0;
    this.t = 0;
    this.water = { amt: 0, pan: 0, big: 0, stream: 0 };
    this.nextBird = 0; this.nextCricket = 0; this.nextOwl = 0; this.nextFrog = 0;
    this.nextChord = 0; this.nextBell = 0; this.chordIdx = 0;
    this.n = createSimplex(4242);
  }

  // Must be called from a user gesture (iOS)
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // iOS 17+: play even when the ringer switch is on silent
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    const ctx = this.ctx = new AC();
    this.white = makeNoise(ctx, 'white', 3);
    this.brown = makeNoise(ctx, 'brown', 6);
    this.pink = makeNoise(ctx, 'pink', 4);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    comp.connect(ctx.destination);
    this.master = this._gain(0, comp);
    this.amb = this._gain(1, this.master);
    this.sfx = this._gain(0.9, this.master);
    this.mus = this._gain(this.musicVolume, this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 3.2, 2.6);
    this.reverbOut = this._gain(0.55, this.master);
    this.reverb.connect(this.reverbOut);

    // Wind: brown noise through a wandering band-pass, plus a thin whistle layer for gusts
    this.wind = this._loopChain(this.brown, [['bandpass', 380, 0.6]], this.amb, true);
    this.whistle = this._loopChain(this.white, [['bandpass', 1700, 6]], this.amb, true);
    // Leaves rustling
    this.leaves = this._loopChain(this.pink, [['highpass', 2200, 0.7], ['lowpass', 7000, 0.7]], this.amb, true);
    // Stream babble: two narrow bands that jump around
    this.stream = this._loopChain(this.white, [['bandpass', 900, 1.8]], this.amb, true);
    this.stream2 = this._loopChain(this.white, [['bandpass', 1500, 2.5]], this.stream.gain, false, true);
    // Waves: deep swell + foam hiss
    this.waves = this._loopChain(this.brown, [['lowpass', 520, 0.5]], this.amb, true);
    this.foam = this._loopChain(this.white, [['highpass', 2600, 0.5]], this.amb, true);

    this.birdRng = mulberry32(777);
    this.species = Array.from({ length: 6 }, () => this._makeSpecies(this.birdRng));
    this.t0 = ctx.currentTime;
    this._applyMaster();
  }

  _gain(v, dest) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  // looping noise source -> filters -> gain -> (panner) -> dest
  _loopChain(buffer, filters, dest, pan, noGainPan) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    let node = src;
    const f = [];
    for (const [type, freq, q] of filters) {
      const bq = ctx.createBiquadFilter();
      bq.type = type; bq.frequency.value = freq; bq.Q.value = q;
      node.connect(bq); node = bq; f.push(bq);
    }
    let gain = null, panner = null;
    if (noGainPan) node.connect(dest);
    else {
      gain = this._gain(0, null);
      node.connect(gain); node = gain;
      if (pan && ctx.createStereoPanner) { panner = ctx.createStereoPanner(); node.connect(panner); node = panner; }
      node.connect(dest);
    }
    src.start(0, Math.random() * buffer.duration);
    return { src, f, gain, panner };
  }

  _set(param, v, tc = 0.3) {
    param.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  _applyMaster() {
    if (!this.ctx) return;
    this._set(this.master.gain, this.volume * (this.paused ? 0.35 : 1), 0.4);
    this._set(this.mus.gain, this.musicVolume, 0.5);
  }

  setVolumes(volume, music) {
    this.volume = volume; this.musicVolume = music;
    this._applyMaster();
  }

  setPaused(p) {
    this.paused = p;
    this._applyMaster();
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  // ------------------------------------------------------------------------
  // Per-frame update. env: { player, gen, timeOfDay, night }
  update(dt, env) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.t += dt;
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 0.4; this._scanWater(env); }
    this.slowT -= dt;
    if (this.slowT > 0) return;
    this.slowT = 0.1;

    const { player: p, gen, night, timeOfDay } = env;
    const s = gen.sample(p.x, p.z);
    const forest = smoothstep(0.0, 0.6, s.forest);
    const alt = clamp((p.y - 8) / 60, 0, 1);
    const indoor = p.surface === 'wood' ? 0.45 : 1;
    const t = this.t;

    // gusts: slow noise, sharper at altitude
    const gust = clamp(0.5 + 0.5 * this.n(t * 0.07, 3.3) + 0.35 * this.n(t * 0.23, 9.1), 0, 1.3);
    const windAmt = (0.12 + 0.22 * alt + 0.18 * gust * (0.5 + alt)) * (1 - 0.45 * forest) * indoor;
    this._set(this.wind.gain.gain, windAmt * 0.55, 0.6);
    this._set(this.wind.f[0].frequency, 260 + 420 * gust + 300 * alt, 0.8);
    if (this.wind.panner) this._set(this.wind.panner.pan, this.n(t * 0.05, 1.7) * 0.6, 1.5);
    const whistle = Math.max(0, gust - 0.75) * alt * 0.05 * indoor;
    this._set(this.whistle.gain.gain, whistle, 0.5);
    this._set(this.whistle.f[0].frequency, 1200 + 900 * gust, 0.6);
    if (this.whistle.panner) this._set(this.whistle.panner.pan, this.n(t * 0.11, 5.5) * 0.8, 1);

    // leaves: follows gusts inside forests
    const leaves = forest * (0.04 + 0.1 * gust) * indoor;
    this._set(this.leaves.gain.gain, leaves, 0.4);
    if (this.leaves.panner) this._set(this.leaves.panner.pan, this.n(t * 0.17, 8.8) * 0.7, 0.8);

    // water
    const w = this.water;
    const streamAmt = w.amt * (w.stream * 0.85 + 0.15) * 0.22 + (p.surface === 'water' ? 0.08 : 0);
    this._set(this.stream.gain.gain, streamAmt, 0.4);
    if (this.stream.panner) this._set(this.stream.panner.pan, w.pan * 0.8, 0.5);
    const now = this.ctx.currentTime;
    // babble: schedule a few random filter jumps over the next 100 ms
    for (let i = 0; i < 3; i++) {
      this.stream.f[0].frequency.setTargetAtTime(500 + Math.random() * 900, now + i * 0.033, 0.02);
      this.stream2.f[0].frequency.setTargetAtTime(1100 + Math.random() * 1500, now + i * 0.033 + 0.015, 0.02);
    }
    const swellPhase = (t / 7.5 + this.n(t * 0.03, 2) * 0.2) % 1;
    const swell = Math.pow(Math.sin(swellPhase * Math.PI), 3);
    const sea = w.amt * w.big;
    this._set(this.waves.gain.gain, sea * (0.08 + 0.3 * swell), 0.25);
    this._set(this.waves.f[0].frequency, 300 + 700 * swell, 0.3);
    const foamPhase = Math.max(0, Math.sin((swellPhase - 0.12) * Math.PI));
    this._set(this.foam.gain.gain, sea * 0.07 * Math.pow(foamPhase, 4), 0.2);
    if (this.waves.panner) { this._set(this.waves.panner.pan, w.pan * 0.7, 0.6); this._set(this.foam.panner.pan, w.pan * 0.8, 0.6); }

    // creatures
    const day = 1 - night;
    const dawn = Math.exp(-Math.pow((timeOfDay - 0.3) / 0.05, 2));
    const birdRate = day * (0.25 + 0.75 * Math.max(forest, smoothstep(0.3, 0.7, s.moisture) * 0.6)) * (1 + 1.6 * dawn) * (1 - alt * 0.7);
    if (t > this.nextBird) {
      if (birdRate > 0.05) this._bird(forest);
      this.nextBird = t + (birdRate > 0.05 ? (0.6 + Math.random() * 3.5) / birdRate : 2);
    }
    if (t > this.nextCricket) {
      if (night > 0.4 && w.big < 0.5) this._cricket();
      this.nextCricket = t + 0.25 + Math.random() * 0.6;
    }
    if (t > this.nextFrog) {
      if (night > 0.3 && w.amt > 0.25 && w.big < 0.6) this._frog(w.pan);
      this.nextFrog = t + 1.2 + Math.random() * 3;
    }
    if (t > this.nextOwl) {
      if (night > 0.7 && forest > 0.2 && this.nextOwl > 0) this._owl();
      this.nextOwl = t + 35 + Math.random() * 60;
    }

    // music
    if (this.musicVolume > 0.001) {
      if (t > this.nextChord) {
        this._chord(night);
        this.nextChord = t + 9 + Math.random() * 5;
      }
      if (t > this.nextBell) {
        if (Math.random() < 0.55) this._bell(night);
        this.nextBell = t + 2.5 + Math.random() * 4;
      }
    }
  }

  // Look around the player for water: distance, direction, size, river or sea
  _scanWater({ player: p, gen }) {
    const DIRS = 12, DIST = [3, 7, 13, 22, 34];
    let best = 0, sx = 0, sz = 0, wet = 0, river = 0;
    const right = [Math.cos(p.yaw), -Math.sin(p.yaw)];
    for (let i = 0; i < DIRS; i++) {
      const a = (i / DIRS) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      for (const d of DIST) {
        const x = p.x + dx * d, z = p.z + dz * d;
        if (gen.height(x, z) < WATER_LEVEL) {
          const close = 1 / (1 + d / 5);
          wet++;
          if (close > best) { best = close; river = gen.sample(x, z).river; }
          sx += dx * close; sz += dz * close;
          break;
        }
      }
    }
    const w = this.water;
    const amt = clamp(best * 1.6, 0, 1);
    w.amt = amt;
    const l = Math.hypot(sx, sz);
    w.pan = l > 1e-3 ? clamp((sx * right[0] + sz * right[1]) / l, -1, 1) : 0;
    w.big = clamp((wet - 3) / 6, 0, 1) * (1 - river * 0.8);
    w.stream = clamp(river * 1.5 + (1 - w.big) * 0.4, 0, 1);
  }

  // ------------------------------------------------------------------------
  // Footstep for a surface: grass, leaves, dirt, sand, stone, wood, water
  step(surface, intensity = 1, side = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime + 0.005;
    const out = this._gain(1, this.sfx);
    let pan = null;
    if (ctx.createStereoPanner) { pan = ctx.createStereoPanner(); pan.pan.value = 0.12 * side; out.disconnect(); out.connect(pan); pan.connect(this.sfx); }
    const v = (0.85 + Math.random() * 0.3) * intensity;

    const burst = (buffer, type, freq, q, at, dur, gain, attack = 0.004) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq * (0.9 + Math.random() * 0.2); f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(gain * v, at + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      src.connect(f); f.connect(g); g.connect(out);
      src.start(at, Math.random() * (buffer.duration - 1));
      src.stop(at + dur + 0.05);
    };
    const thump = (freq, at, dur, gain) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, at);
      o.frequency.exponentialRampToValueAtTime(freq * 0.55, at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain * v, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g); g.connect(out);
      o.start(at); o.stop(at + dur + 0.02);
    };

    switch (surface) {
      case 'grass':
        for (let i = 0; i < 3; i++) burst(this.white, 'bandpass', 3200, 0.9, t + i * 0.025 + Math.random() * 0.02, 0.07, 0.11);
        burst(this.pink, 'lowpass', 900, 0.7, t, 0.12, 0.12, 0.01);
        break;
      case 'leaves':
        for (let i = 0; i < 4; i++) burst(this.white, 'bandpass', 2600 + Math.random() * 2000, 1.4, t + i * 0.03 + Math.random() * 0.02, 0.06, 0.13);
        burst(this.pink, 'lowpass', 700, 0.7, t, 0.1, 0.1, 0.008);
        break;
      case 'dirt':
        thump(95, t, 0.09, 0.22);
        burst(this.white, 'bandpass', 1400, 0.8, t, 0.1, 0.13);
        burst(this.white, 'highpass', 4500, 0.7, t + 0.02, 0.05, 0.05);
        break;
      case 'sand':
        burst(this.pink, 'bandpass', 1600, 0.5, t, 0.2, 0.16, 0.03);
        burst(this.white, 'highpass', 5000, 0.6, t + 0.02, 0.12, 0.04, 0.02);
        break;
      case 'stone':
        thump(140, t, 0.05, 0.16);
        burst(this.white, 'bandpass', 2400, 2.5, t, 0.04, 0.16, 0.001);
        burst(this.white, 'highpass', 6000, 0.7, t + 0.01, 0.03, 0.05, 0.001);
        this._send(out, 0.25);
        break;
      case 'wood':
        thump(170, t, 0.13, 0.3);
        thump(330, t, 0.06, 0.08);
        burst(this.white, 'bandpass', 1800, 3, t, 0.03, 0.08, 0.001);
        this._send(out, 0.35);
        break;
      case 'water':
        burst(this.white, 'bandpass', 900, 1.2, t, 0.25, 0.2, 0.02);
        burst(this.white, 'bandpass', 2400, 1.5, t + 0.05, 0.22, 0.09, 0.03);
        burst(this.brown, 'lowpass', 400, 0.7, t, 0.2, 0.25, 0.02);
        break;
    }
    setTimeout(() => out.disconnect(), 800);
  }

  _send(node, amount) {
    const g = this._gain(amount, this.reverb);
    node.connect(g);
    setTimeout(() => g.disconnect(), 4000);
  }

  // ------------------------------------------------------------------------
  // Creatures

  _makeSpecies(rng) {
    const trill = rng() < 0.3;
    const base = 2200 + rng() * 2800;
    const notes = [];
    const n = trill ? 6 + Math.floor(rng() * 8) : 2 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      notes.push({
        r: trill ? 1 + (rng() - 0.5) * 0.05 : 0.75 + rng() * 0.6,
        sweep: trill ? 0.85 : 0.7 + rng() * 0.7,
        dur: trill ? 0.025 + rng() * 0.02 : 0.05 + rng() * 0.12,
        gap: trill ? 0.02 : 0.03 + rng() * 0.08,
      });
    }
    return { base, notes, repeats: 1 + Math.floor(rng() * 3) };
  }

  _bird(forest) {
    const ctx = this.ctx;
    const sp = this.species[Math.floor(Math.random() * this.species.length)];
    const dist = Math.random();
    const out = this._gain(0.025 + 0.07 * (1 - dist), null);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 9000 - dist * 5000;
    out.connect(lp);
    let dest = lp;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = (Math.random() * 2 - 1) * 0.9; lp.connect(p); dest = p; }
    dest.connect(this.amb);
    this._send(dest, 0.2 + 0.25 * forest + 0.2 * dist);
    let t = ctx.currentTime + 0.02;
    const pitch = 0.94 + Math.random() * 0.12;
    const reps = sp.repeats;
    for (let r = 0; r < reps; r++) {
      for (const note of sp.notes) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        const f = sp.base * note.r * pitch;
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * note.sweep, t + note.dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.001, t + note.dur);
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + note.dur + 0.02);
        t += note.dur + note.gap;
      }
      t += 0.15 + Math.random() * 0.2;
    }
    setTimeout(() => { out.disconnect(); }, (t - ctx.currentTime) * 1000 + 4000);
  }

  _cricket() {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 4100 + Math.random() * 700;
    const g = ctx.createGain();
    g.gain.value = 0;
    const a = 0.008 + Math.random() * 0.012;
    const pulses = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pulses; i++) {
      const s = t + i * 0.04;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(a, s + 0.006);
      g.gain.linearRampToValueAtTime(0, s + 0.026);
    }
    let dest = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.random() * 2 - 1; g.connect(p); dest = p; }
    o.connect(g); dest.connect(this.amb);
    o.start(t); o.stop(t + pulses * 0.04 + 0.05);
  }

  _frog(pan) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 90 + Math.random() * 60;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * 1.15, t + 0.25);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 400; bp.Q.value = 5;
    const g = ctx.createGain();
    g.gain.value = 0;
    const n = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.035;
      g.gain.setValueAtTime(0.05, s);
      g.gain.linearRampToValueAtTime(0, s + 0.03);
    }
    let dest = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan + (Math.random() - 0.5) * 0.6, -1, 1); g.connect(p); dest = p; }
    o.connect(bp); bp.connect(g); dest.connect(this.amb);
    this._send(dest, 0.2);
    o.start(t); o.stop(t + n * 0.035 + 0.05);
  }

  _owl() {
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.05;
    const out = this._gain(0.06, null);
    let dest = out;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = (Math.random() * 2 - 1) * 0.8; out.connect(p); dest = p; }
    dest.connect(this.amb);
    this._send(dest, 0.6);
    const hoots = [[0.45, 1], [0.18, 0.95], [0.6, 0.9]];
    for (const [dur, r] of hoots) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = 360 * r;
      o.frequency.setValueAtTime(f * 1.04, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.94, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.05);
      g.gain.setValueAtTime(1, t + dur * 0.7);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.05);
      t += dur + 0.2;
    }
    setTimeout(() => out.disconnect(), 8000);
  }

  // ------------------------------------------------------------------------
  // Music

  _chord(night) {
    const ctx = this.ctx;
    const chord = CHORDS[this.chordIdx++ % CHORDS.length];
    const t = ctx.currentTime + 0.05;
    const att = 3, hold = 5, rel = 6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = night > 0.5 ? 700 : 1100; lp.Q.value = 0.3;
    const out = this._gain(1, this.mus);
    lp.connect(out);
    this._send(out, 0.8);
    const shift = night > 0.5 ? -12 : 0;
    for (const m of chord) {
      for (const [type, det, a] of [['triangle', -5, 0.016], ['sine', 6, 0.02]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = mtof(m + shift + (m + shift < 40 ? 12 : 0));
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a, t + att);
        g.gain.setValueAtTime(a, t + att + hold);
        g.gain.linearRampToValueAtTime(0, t + att + hold + rel);
        o.connect(g); g.connect(lp);
        o.start(t); o.stop(t + att + hold + rel + 0.1);
      }
    }
    setTimeout(() => out.disconnect(), (att + hold + rel + 5) * 1000);
  }

  _bell(night) {
    const ctx = this.ctx;
    const m = MELODY[Math.floor(Math.random() * MELODY.length)] - (night > 0.5 ? 12 : 0);
    const t = ctx.currentTime + 0.05;
    const out = this._gain(0.022, this.mus);
    this._send(out, 1);
    for (const [ratio, a, dur] of [[1, 1, 3], [2.0, 0.25, 1.4], [3.01, 0.08, 0.8]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = mtof(m) * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.05);
    }
    setTimeout(() => out.disconnect(), 6000);
  }
}
