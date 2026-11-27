export const MIN_CHIP_SIZE = 0.001;
export const MAX_TRAIL_MS = 6000;
export const MAX_FOCUS_DISTANCE = 300;
export const FOCAL_LENGTH_BOUNDS = [25, 200];

export const MATERIAL_DEFAULTS = { metalness: 0.8, roughness: 0.22 };
export const NOISE_DEFAULTS = [{ rate: 0.5, detail: 20 }, { rate: 1, detail: 20 }, { rate: 2, detail: 20 }];
export const CHANNEL_BOUNDS = { rate: [0.05, 8], detail: [0, 100] };

export const EMITTER_BOUNDS = {
  rate: [0, 400], lifetime: [0.1, 8], lifetimeVariation: [0, 100], size: [MIN_CHIP_SIZE, 0.3], sizeVariation: [0, 150],
  speed: [0, 10], speedVariation: [0, 200], launchSpread: [0, 200], hueVariation: [0, 180], drawSpeed: [0, 100],
  smoothing: [0, 100], rotationSpeed: [0, 360], rotationVariation: [0, 100], splitChance: [0, 100],
  burstSizeVariation: [0, 100], brightnessVariation: [0, 100], sparkleAmount: [0, 100],
  birthScatter: [0, 1], weldingSparks: [0, 100], trail: [0, MAX_TRAIL_MS], trailWidth: [0, 300],
  trailLengthVariation: [0, 100], trailWidthVariation: [0, 100],
};

export const FORCE_BOUNDS = {
  gravity: [-10, 10], turbulence: [0, 10], drag: [0, 8],
  windX: [-8, 8], windY: [-8, 8], windZ: [-8, 8],
};
export const WIND_KEYS = ['windX', 'windY', 'windZ'];
export const EFFECT_BOUNDS = {
  depth: [0, 5], shutter: [0, 360], focus: [0.2, MAX_FOCUS_DISTANCE],
  metalness: [0, 1], roughness: [0.05, 1],
};
export const EFFECT_NOISE_BOUNDS = { ...EFFECT_BOUNDS, focalLength: FOCAL_LENGTH_BOUNDS, referenceDarkening: [0, 100] };
export const LIVE_EMITTER_KEYS = ['trail', 'trailWidth', 'trailLengthVariation', 'trailWidthVariation', 'hueVariation'];

function lattice(index, seed) {
  let hash = Math.imul(index ^ seed, 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 2147483648 - 1;
}

function temporalNoise(time, seed) {
  const index = Math.floor(time);
  const fraction = time - index;
  const transition = fraction * fraction * fraction * (fraction * (fraction * 6 - 15) + 10);
  const start = lattice(index, seed);
  return start + (lattice(index + 1, seed) - start) * transition;
}

export function noiseValues(sources, seed, time) {
  return sources.map(({ rate, detail }, index) => {
    const salt = seed ^ Math.imul(index + 1, 0x9e3779b9);
    const amplitude = detail / 200;
    const sample = temporalNoise(time * rate, salt);
    return amplitude ? (sample + amplitude * temporalNoise(time * rate * 2.03, salt ^ 0x5ce42)) / (1 + amplitude) : sample;
  });
}

export function modulationValue(value, assignment, bounds, signals) {
  if (!assignment?.amount) return value;
  const [min, max] = bounds;
  return Math.max(min, Math.min(max, value + (signals[assignment.channel] ?? 0) * (max - min) * assignment.amount / 100));
}

export function modulateSettings(settings, bounds, signals, keys) {
  if (!settings.noise || !signals.length) return settings;
  let result = settings;
  for (const [key, assignment] of Object.entries(settings.noise)) {
    if (!bounds[key] || !assignment.amount || (keys && !keys.includes(key))) continue;
    if (result === settings) result = { ...settings };
    result[key] = modulationValue(settings[key], assignment, bounds[key], signals);
  }
  return result;
}
