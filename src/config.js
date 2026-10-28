// Global constants, quality presets and persisted settings.

export const CHUNK_SIZE = 32;          // meters per chunk side
export const WATER_LEVEL = 0;          // world-space water height
export const EYE_HEIGHT = 1.65;

export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export const QUALITY = {
  low: {
    label: 'Basse', pixelRatio: 1, shadowSize: 1024, shadowExtent: 40,
    nearRadius: 2, farRadius: 6, propRadius: 2, grassRadius: 0, grassSpacing: 0.8,
  },
  medium: {
    label: 'Moyenne', pixelRatio: 1.5, shadowSize: 1536, shadowExtent: 50,
    nearRadius: 3, farRadius: 8, propRadius: 3, grassRadius: 1, grassSpacing: 0.7,
  },
  high: {
    label: 'Haute', pixelRatio: 2, shadowSize: 2048, shadowExtent: 60,
    nearRadius: 4, farRadius: 10, propRadius: 4, grassRadius: 1, grassSpacing: 0.55,
  },
};

const STORAGE_KEY = 'everlune.v1';

const defaults = {
  seed: 'everlune',
  quality: isTouch ? 'medium' : 'high',
  sensitivity: 1,
  dayLength: 16,            // real minutes per full day
  timeOfDay: 0.3,           // 0..1, 0.25 = sunrise, 0.5 = noon
  player: null,             // {x, z, yaw, pitch}
  discovered: [],
  volume: 0.8,
  music: 0.35,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch (e) { /* storage unavailable */ }
  return { ...defaults };
}

export function saveSettings(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}
