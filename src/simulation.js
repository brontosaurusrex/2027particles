import { CatmullRomCurve3, Euler, MathUtils, Quaternion, ShapeUtils, Vector2, Vector3 } from 'three/webgpu';
import { DEFAULT_BRIGHTNESS } from './lifetime.js';
import { EMITTER_BOUNDS, FORCE_BOUNDS, MIN_CHIP_SIZE, MAX_TRAIL_MS, WIND_KEYS,
  modulateSettings, modulationValue, noiseValues } from './modulation.js';
export { MIN_CHIP_SIZE, MAX_TRAIL_MS };

export const FPS = 50;
export const FRAME_COUNT = 500;
export const MAX_DURATION_FRAMES = FPS * 60 * 10;
export const STEP = 1 / FPS;
export const CAPACITY = 2400;
export const EMITTER_LIMIT = 32;
export const TRAIL_HISTORY = Math.ceil(2 * MAX_TRAIL_MS / (1000 * STEP)) + 1;
export const TRAIL_DEFAULTS = { trail: 110, trailWidth: 100, trailLengthVariation: 0, trailWidthVariation: 0 };
export const PALETTES = {
  original: { label: 'Original', tints: [[0, 0, 0]] },
  silver: {
    label: 'Silver / Ferrari Red / Fir Green',
    tints: [[0.8, 0.91, 1], [1, 0.018, 0.025], [0.035, 0.52, 0.14]],
  },
  festive: {
    label: 'Ferrari Red / Fir Green / Gold',
    tints: [[1, 0.018, 0.025], [0.035, 0.52, 0.14], [1, 0.56, 0.065]],
  },
};
const TAU = 2 * Math.PI;
const DEFAULT_ROTATION_SPEED = 180;
const DEFAULT_ROTATION_VARIATION = 50;
const DEFAULT_LIFETIME_VARIATION = 28;
const BURST_SIZE = 6;
const BURST_GLINT_BOOST = 0.7 / 0.46;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function frameCountAtRate(durationFrames, rate) {
  return Math.ceil(durationFrames * rate / FPS);
}

export function frameAtRate(simulationFrame, rate) {
  return Math.floor((simulationFrame - 1) * rate / FPS) + 1;
}

export function simulationFrameAtRate(frame, rate) {
  return 1 + (frame - 1) * FPS / rate;
}

export function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function emitterSettings(source = {}) {
  const {
    rate = 115, lifetime = 2.4, lifetimeVariation = DEFAULT_LIFETIME_VARIATION,
    size = 0.085, sizeVariation = 100, speed = 2.6, speedVariation = 25, launchSpread = 100,
    hueVariation = 0, drawSpeed = 25, drawDirection = 'as-drawn', smoothing = 0,
    brightness = DEFAULT_BRIGHTNESS, brightnessVariation = 0,
    rotationSpeed = DEFAULT_ROTATION_SPEED, rotationVariation = DEFAULT_ROTATION_VARIATION,
    splitChance = 0, burstSizeVariation = 0, sparkleAmount = 0,
    palette = 'original', birthScatter = 0, weldingSparks = 0, trailOnly = false,
    trail = TRAIL_DEFAULTS.trail, trailWidth = TRAIL_DEFAULTS.trailWidth,
    trailLengthVariation = TRAIL_DEFAULTS.trailLengthVariation, trailWidthVariation = TRAIL_DEFAULTS.trailWidthVariation,
    noise = {},
  } = source;
  return {
    rate, lifetime, lifetimeVariation, size, sizeVariation, speed, speedVariation, launchSpread, hueVariation,
    drawSpeed, drawDirection, smoothing, rotationSpeed, rotationVariation, splitChance, burstSizeVariation,
    brightness: [...brightness], brightnessVariation, sparkleAmount,
    palette, birthScatter, weldingSparks, trailOnly, trail, trailWidth, trailLengthVariation, trailWidthVariation,
    noise: structuredClone(noise),
  };
}

export function createEmitter(id, kind, points, position = [0, 0, 0], rotation = [0, 0, 0], source) {
  return { id, kind, points, position, rotation, muted: false, ...emitterSettings(source) };
}

export function strokeDuration(emitter) {
  return emitter.kind !== 'area' && emitter.drawSpeed > 0 ? 100 / emitter.drawSpeed : Infinity;
}

export function primitivePoints(shape, [cx, cy], [x, y], constrain = false) {
  const dx = x - cx;
  const dy = y - cy;
  if (shape === 'rectangle') {
    const width = constrain ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.abs(dx);
    const height = constrain ? width : Math.abs(dy);
    if (width < 0.05 || height < 0.05) return [];
    const corners = [[-width, -height], [width, -height], [width, height], [-width, height]];
    const start = dy < 0 ? (dx < 0 ? 0 : 1) : (dx < 0 ? 3 : 2);
    return Array.from({ length: 4 }, (_, index) => {
      const [px, py] = corners[(start + index) % 4];
      return [cx + px, cy + py];
    });
  }
  const radius = Math.hypot(dx, dy);
  if (radius < 0.05) return [];
  const start = Math.atan2(dy, dx);
  const segments = 96;
  return Array.from({ length: segments }, (_, index) => {
    const angle = start + index * TAU / segments;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
}

export function curvePoints(anchors, closed) {
  if (anchors.length < 3) return anchors;
  const curve = new CatmullRomCurve3(anchors.map(([x, y]) => new Vector3(x, y, 0)), closed);
  const segments = closed ? anchors.length : anchors.length - 1;
  // Use equal subdivisions per section so every clicked anchor lies on the sampled stroke.
  const points = curve.getPoints(segments * Math.min(24, Math.floor(511 / segments)));
  if (closed) points.pop();
  return points.map(({ x, y }) => [x, y]);
}

// Chaikin corner cutting rounds each corner and keeps open stroke endpoints fixed.
function smoothStroke(points, closed, smoothing) {
  if (points.length < 3 || !smoothing) return points;
  const cut = MathUtils.clamp(smoothing / 100, 0, 1) * 0.25;
  let vertices = points;
  for (let pass = 0; pass < 3; pass++) {
    const rounded = closed ? [] : [vertices[0]];
    const segments = closed ? vertices.length : vertices.length - 1;
    for (let index = 0; index < segments; index++) {
      const [ax, ay] = vertices[index];
      const [bx, by] = vertices[(index + 1) % vertices.length];
      rounded.push([MathUtils.lerp(ax, bx, cut), MathUtils.lerp(ay, by, cut)]);
      rounded.push([MathUtils.lerp(bx, ax, cut), MathUtils.lerp(by, ay, cut)]);
    }
    if (!closed) rounded.push(vertices.at(-1));
    vertices = rounded;
  }
  return vertices;
}

export function outlineDirection(points) {
  let signedArea = 0;
  for (const [index, [x, y]] of points.entries()) {
    const [nextX, nextY] = points[(index + 1) % points.length];
    signedArea += x * nextY - y * nextX;
  }
  return signedArea < 0 ? 'clockwise' : 'counterclockwise';
}

export function strokePath({ kind, points, smoothing = 0, primitive, drawSpeed, drawDirection }) {
  const closed = kind !== 'line';
  const path = smoothStroke(points, closed, kind === 'area' || primitive ? 0 : smoothing);
  const reverse = drawSpeed !== 0 && (kind === 'line' ? drawDirection === 'reverse' :
    kind === 'outline' && (drawDirection === 'clockwise' || drawDirection === 'counterclockwise') &&
    drawDirection !== outlineDirection(points));
  const vertices = closed ? [...path, path[0]] : reverse ? [...path] : path;
  if (reverse) vertices.reverse();
  let length = 0;
  const distances = vertices.map(([x, y], index) => {
    if (index > 0) length += Math.hypot(x - vertices[index - 1][0], y - vertices[index - 1][1]);
    return length;
  });
  return { vertices, distances, length };
}

export function positionOnStroke({ vertices, distances, length }, progress) {
  const distance = MathUtils.clamp(progress, 0, 1) * length;
  let low = 1;
  let high = distances.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (distances[mid] <= distance) low = mid + 1;
    else high = mid;
  }
  const index = Math.min(low, vertices.length - 1);
  const [x, y] = vertices[index];
  if (low === vertices.length) return { x, y, index };
  const [previousX, previousY] = vertices[index - 1];
  const fraction = (distance - distances[index - 1]) / (distances[index] - distances[index - 1]);
  return { x: MathUtils.lerp(previousX, x, fraction), y: MathUtils.lerp(previousY, y, fraction), index };
}

export function emitterRotation(emitter) {
  return new Quaternion().setFromEuler(new Euler(...emitter.rotation.map(MathUtils.degToRad), 'XYZ'));
}

export function polygonFaces(points) {
  return ShapeUtils.triangulateShape(points.map(([x, y]) => new Vector2(x, y)), []);
}

function signedTurn(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function intersects(a, b, c, d) {
  const overlaps = [0, 1].every(axis =>
    Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) <=
    Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])));
  return overlaps && signedTurn(a, b, c) * signedTurn(a, b, d) <= 0 &&
    signedTurn(c, d, a) * signedTurn(c, d, b) <= 0;
}

export function validateStroke(kind, points) {
  if (points.length < (kind === 'line' ? 2 : 3)) return 'Draw a longer stroke.';
  if (kind !== 'area') return '';
  for (let i = 0; i < points.length; i++) {
    const end = (i + 1) % points.length;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      if (intersects(points[i], points[end], points[j], points[(j + 1) % points.length])) {
        return 'Draw a filled area with a boundary that does not cross itself.';
      }
    }
  }
  const area = polygonFaces(points).reduce((sum, [a, b, c]) =>
    sum + Math.abs(signedTurn(points[a], points[b], points[c])) / 2, 0);
  return area < 0.002 ? 'Draw a wider shape for a filled area.' : '';
}

export function emitterSampler(emitter) {
  const { points, kind } = emitter;
  const rotation = emitterRotation(emitter);
  const position = new Vector3(...emitter.position);
  const path = kind === 'area' ? null : strokePath(emitter.noise?.drawSpeed?.amount ? { ...emitter, drawSpeed: 1 } : emitter);
  let area = 0;
  const parts = [];
  if (kind === 'area') {
    for (const [a, b, c] of polygonFaces(points)) {
      const weight = Math.abs(signedTurn(points[a], points[b], points[c])) / 2;
      if (weight <= 0) continue;
      area += weight;
      parts.push({ vertices: [points[a], points[b], points[c]], end: area });
    }
  }

  const normal = new Vector3(0, 0, 1).applyQuaternion(rotation);
  return {
    normal,
    path,
    sample(random, progress, animatedPath = path) {
      if (animatedPath) {
        const { x, y } = positionOnStroke(animatedPath, progress ?? random());
        return new Vector3(x, y, 0).applyQuaternion(rotation).add(position);
      }
      const choice = random() * area;
      const { vertices: [a, b, c] } = parts.find(part => choice < part.end);
      const u = Math.sqrt(random());
      const v = random();
      const x = (1 - u) * a[0] + u * ((1 - v) * b[0] + v * c[0]);
      const y = (1 - u) * a[1] + u * ((1 - v) * b[1] + v * c[1]);
      return new Vector3(x, y, 0).applyQuaternion(rotation).add(position);
    },
  };
}

function particleSpin(random, speed) {
  const axis = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5);
  return axis.normalize().multiplyScalar(speed).toArray();
}

function particleHistory(position) {
  return {
    position, previous: position.clone(),
    history: new Float32Array(TRAIL_HISTORY * 4), historyNext: 0, historyCount: 0,
  };
}

export class Simulation {
  constructor(settings, emitters, shapeChoices, visibleEmitterIds = null, sources = []) {
    this.settings = settings;
    this.noiseSources = sources;
    this.simulationNoise = Object.keys(settings.noise ?? {}).length || emitters.some(emitter => Object.keys(emitter.noise ?? {}).length);
    this.emitters = emitters.map(emitter => ({ ...emitter, ...emitterSampler(emitter), drawDuration: strokeDuration(emitter) }));
    this.shapeChoices = shapeChoices;
    this.uniqueShapes = [...new Set(shapeChoices)];
    this.circleShape = shapeChoices.find((shape, index) => shapeChoices.indexOf(shape) !== index) ?? shapeChoices[0];
    this.visibleEmitterIds = visibleEmitterIds;
    this.reset();
  }

  reset() {
    this.frame = 0;
    this.particles = [];
    this.random = randomSource(this.settings.seed);
    this.hueRandom = randomSource(this.settings.seed ^ 0x9e3779b9);
    this.rotationRandom = randomSource(this.settings.seed ^ 0xc2b2ae35);
    this.trailRandom = randomSource(this.settings.seed ^ 0x85ebca6b);
    this.trailWidthRandom = randomSource(this.settings.seed ^ 0x419ee343);
    this.splitRandom = randomSource(this.settings.seed ^ 0x27d4eb2f);
    this.fragmentRandom = randomSource(this.settings.seed ^ 0x165667b1);
    this.burstCountRandom = randomSource(this.settings.seed ^ 0xd3a2646c);
    this.brightnessRandom = randomSource(this.settings.seed ^ 0xfd7046c5);
    this.fragmentBrightnessRandom = randomSource(this.settings.seed ^ 0x94d049bb);
    this.glintSizeRandom = randomSource(this.settings.seed ^ 0x632be59b);
    this.scatterRandom = randomSource(this.settings.seed ^ 0xaa483cc1);
    this.weldingRandom = randomSource(this.settings.seed ^ 0x3859f3a7);
    this.paletteRandom = randomSource(this.settings.seed ^ 0xec4e6c89);
    for (const emitter of this.emitters) {
      emitter.reveal = 0;
      emitter.emission = 0;
      emitter.currentPath = emitter.path;
    }
  }

  noiseAt(time) {
    return noiseValues(this.noiseSources, this.settings.seed, time);
  }

  tintIndex(emitter) {
    const { tints } = PALETTES[emitter.palette] ?? PALETTES.original;
    return tints.length > 1 ? Math.floor(this.paletteRandom() * tints.length) : 0;
  }

  seek(frame) {
    if (frame < this.frame) this.reset();
    while (this.frame < frame) this.step();
  }

  burst(parent, birth) {
    const { burstCount } = parent;
    const random = this.fragmentRandom;
    const offset = TAU * random();
    const colorOffset = random();
    const shapes = this.uniqueShapes.filter(shape => shape !== parent.shape);
    const spin = Math.hypot(...parent.spin);
    const glintChance = Math.min(1, parent.glintChance * BURST_GLINT_BOOST);
    for (let index = 0; index < burstCount; index++) {
      const z = (2 * (index + 0.5)) / burstCount - 1;
      const radius = Math.sqrt(1 - z * z);
      const angle = offset + index * GOLDEN_ANGLE;
      const [shape = parent.shape] = shapes.splice(Math.floor(random() * shapes.length), 1);
      const velocity = new Vector3(radius * Math.cos(angle), radius * Math.sin(angle), z)
        .multiplyScalar(0.75 * (1.8 + 1.6 * random())).addScaledVector(parent.velocity, 0.5);
      this.particles.push({
        birth, death: birth + 0.4 + 0.35 * random(),
        emitterId: parent.emitterId,
        style: parent.style,
        tintIndex: this.tintIndex(parent.style),
        brightness: parent.brightness,
        brightnessScale: 1 + (2 * this.fragmentBrightnessRandom() - 1) * parent.brightnessVariation,
        ...particleHistory(parent.position.clone()),
        velocity,
        trailLengthJitter: 2 * random() - 1,
        trailWidthJitter: 2 * this.trailWidthRandom() - 1,
        rotation: [TAU * random(), TAU * random(), TAU * random()],
        spin: particleSpin(random, spin * (1 + random())),
        size: parent.size * (0.4 + 0.22 * random()),
        phase: random() * TAU,
        flashRate: 10 + 12 * random(),
        glint: random() < glintChance,
        glintSizeScale: 0.75 + 0.5 * this.glintSizeRandom(),
        shape, shade: parent.shade,
        hueFactor: 2 * ((colorOffset + index / burstCount) % 1) - 1,
        hue: (2 * ((colorOffset + index / burstCount) % 1) - 1) * parent.hueRange,
      });
    }
  }

  step() {
    const start = this.frame * STEP;
    const end = ++this.frame * STEP;
    const signals = this.simulationNoise ? this.noiseAt(start) : [];
    const { gravity, wind, turbulence, drag = 0 } = modulateSettings(this.settings, FORCE_BOUNDS, signals,
      ['gravity', 'turbulence', 'drag']);
    const forceWind = this.settings.noise ? WIND_KEYS.map((key, axis) =>
      modulationValue(wind[axis], this.settings.noise[key], FORCE_BOUNDS[key], signals)) : wind;
    const random = this.random;
    this.particles = this.particles.filter(particle => particle.death > start);

    for (const base of this.emitters) {
      const emitter = modulateSettings(base, EMITTER_BOUNDS, signals);
      const { drawDuration } = base;
      const animatedDraw = base.kind !== 'area' && base.noise?.drawSpeed?.amount;
      const progress = base.reveal;
      const drawRate = emitter.drawSpeed / 100;
      if (animatedDraw ? progress >= 1 : start >= drawDuration) continue;
      const activeEnd = animatedDraw
        ? Math.min(end, drawRate > 0 ? start + (1 - progress) / drawRate : end)
        : Math.min(end, drawDuration);
      if (animatedDraw) base.reveal = Math.min(1, progress + STEP * drawRate);
      if (base.path && base.noise?.smoothing?.amount && !base.primitive) {
        base.currentPath = strokePath(animatedDraw ? { ...emitter, drawSpeed: 1 } : emitter);
      }
      const sizeVariation = (emitter.sizeVariation ?? 100) / 100;
      const lifetimeVariation = (emitter.lifetimeVariation ?? DEFAULT_LIFETIME_VARIATION) / 100;
      const hueRange = MathUtils.degToRad(emitter.hueVariation ?? 0);
      const { birthScatter = 0, weldingSparks = 0 } = emitter;
      const rotationSpeed = MathUtils.degToRad(emitter.rotationSpeed ?? DEFAULT_ROTATION_SPEED);
      const rotationVariation = (emitter.rotationVariation ?? DEFAULT_ROTATION_VARIATION) / 100;
      const splitChance = (emitter.splitChance ?? 0) / 100;
      const launchSpread = (emitter.launchSpread ?? 100) / 100;
      const launchDirection = launchSpread === 1 ? null : new Vector3(0, 0.66, 0).addScaledVector(emitter.normal, 0.525);
      const brightnessVariation = (emitter.brightnessVariation ?? 0) / 100;
      const glintChance = (emitter.sparkleAmount ?? 0) / 100;
      const burstSizeVariation = (emitter.burstSizeVariation ?? 0) / 100;
      const maxBurstCount = BURST_SIZE + Math.round(3 * burstSizeVariation);
      const animatedRate = base.noise?.rate?.amount;
      const countAtStart = animatedRate ? base.emission : start * emitter.rate;
      const countAtEnd = animatedRate ? countAtStart + (activeEnd - start) * emitter.rate : activeEnd * emitter.rate;
      if (animatedRate) base.emission = countAtEnd;
      const first = Math.floor(countAtStart + 1e-8) + 1;
      const last = Math.floor(countAtEnd + 1e-8);
      for (let i = first; i <= last && this.particles.length < CAPACITY; i++) {
        const birth = animatedRate
          ? Math.max(start, start + (i - 0.5 - countAtStart) / emitter.rate)
          : Math.max(start, (i - 0.5) / emitter.rate);
        const reveal = animatedDraw ? progress + (birth - start) * drawRate
          : Number.isFinite(drawDuration) ? birth / drawDuration : undefined;
        const position = base.sample(random, reveal, base.currentPath);
        if (birthScatter > 0) {
          const z = 2 * this.scatterRandom() - 1;
          const angle = TAU * this.scatterRandom();
          const radius = Math.sqrt(1 - z * z);
          const distance = birthScatter * Math.cbrt(this.scatterRandom());
          position.addScaledVector(new Vector3(radius * Math.cos(angle), radius * Math.sin(angle), z), distance);
        }
        const angle = TAU * random();
        const outward = 0.34 + 0.66 * random();
        const velocity = new Vector3(Math.cos(angle) * outward, Math.sin(angle) * outward, 0)
          .addScaledVector(emitter.normal, 0.15 + 0.75 * random())
          .add(new Vector3(0, 0.66, 0));
        if (launchDirection) {
          const speed = velocity.length();
          velocity.multiplyScalar(launchSpread).addScaledVector(launchDirection, 1 - launchSpread).setLength(speed);
        }
        const variation = emitter.speedVariation > 0 ? (2 * random() - 1) * emitter.speedVariation / 100 : 0;
        velocity.multiplyScalar(emitter.speed * Math.max(0, 1 + variation));
        const lifetime = Math.max(0.001, emitter.lifetime * (1 - lifetimeVariation + 2 * lifetimeVariation * random()));
        const splits = this.splitRandom() < splitChance;
        const splitAge = lifetime * (0.2 + 0.7 * this.splitRandom());
        const particle = {
          emitterId: emitter.id,
          style: base,
          tintIndex: this.tintIndex(emitter),
          birth,
          death: birth + lifetime,
          burstAt: splits ? birth + splitAge : Infinity,
          burstCount: splits ? BURST_SIZE + Math.floor(this.burstCountRandom() * (maxBurstCount - BURST_SIZE + 1)) : 0,
          brightness: emitter.brightness ?? DEFAULT_BRIGHTNESS,
          brightnessVariation,
          brightnessScale: 1 + (2 * this.brightnessRandom() - 1) * brightnessVariation,
          ...particleHistory(position),
          velocity,
          trailLengthJitter: 2 * this.trailRandom() - 1,
          trailWidthJitter: 2 * this.trailWidthRandom() - 1,
          rotation: [TAU * random(), TAU * random(), TAU * random()],
          spin: particleSpin(random, rotationSpeed * (1 + (2 * this.rotationRandom() - 1) * rotationVariation)),
          size: emitter.size * MathUtils.lerp(1, 0.38 + 0.95 * random() ** 2, sizeVariation),
          phase: random() * TAU,
          flashRate: 6 + 14 * random(),
          glint: random() < glintChance,
          glintChance,
          glintSizeScale: 0.75 + 0.5 * this.glintSizeRandom(),
          shape: this.shapeChoices[Math.floor(random() * this.shapeChoices.length)],
          shade: Math.floor(random() * 5),
          hueRange,
          hueFactor: this.hueRandom() * 2 - 1,
        };
        particle.hue = particle.hueFactor * hueRange;
        this.particles.push(particle);
        if (weldingSparks > 0 && this.particles.length < CAPACITY && this.weldingRandom() * 100 < weldingSparks) {
          const sparks = this.weldingRandom;
          this.particles.push({
            ...particle,
            ...particleHistory(position.clone()),
            velocity: new Vector3(2 * sparks() - 1, 2 * sparks() - 1, 2 * sparks() - 1).multiplyScalar(2.5)
              .addScaledVector(velocity, 0.5),
            death: birth + lifetime / 3, burstAt: Infinity, burstCount: 0,
            size: particle.size * 0.18, glint: false, shape: this.circleShape,
          });
        }
      }
    }

    for (const particle of this.particles) {
      const { position, previous, velocity, birth, phase } = particle;
      const dueToBurst = particle.burstAt <= end;
      const canBurst = dueToBurst && this.particles.length <= CAPACITY - particle.burstCount;
      if (dueToBurst && !canBurst) particle.burstAt = Infinity;
      const sampleTime = Math.max(start, birth);
      const duration = (canBurst ? particle.burstAt : end) - sampleTime;
      previous.copy(position);
      const offset = particle.historyNext * 4;
      particle.history[offset] = position.x;
      particle.history[offset + 1] = position.y;
      particle.history[offset + 2] = position.z;
      particle.history[offset + 3] = sampleTime;
      particle.historyNext = (particle.historyNext + 1) % TRAIL_HISTORY;
      particle.historyCount = Math.min(particle.historyCount + 1, TRAIL_HISTORY);
      const forceTime = drag > 0 ? -Math.expm1(-drag * duration) / drag : duration;
      velocity.multiplyScalar(1 - drag * forceTime);
      velocity.x += (forceWind[0] + turbulence * Math.sin(position.y * 1.4 + start * 2.5 + phase)) * forceTime;
      velocity.y += (forceWind[1] - gravity + turbulence * Math.sin(position.z * 1.8 - start * 1.8 + phase * 2)) * forceTime;
      velocity.z += (forceWind[2] + turbulence * Math.sin(position.x * 1.7 + start * 1.9 - phase)) * forceTime;
      position.addScaledVector(velocity, duration);
      if (canBurst) {
        particle.lifetime = particle.death - birth;
        particle.death = particle.burstAt;
        this.burst(particle, particle.burstAt);
      }
    }
  }

  sample(time, visit) {
    const end = this.frame * STEP;
    for (const particle of this.particles) {
      if (time < particle.birth || time >= particle.death) continue;
      // Filter output only so isolating an emitter preserves seeded motion and bursts.
      if (this.visibleEmitterIds && !this.visibleEmitterIds.has(particle.emitterId)) continue;
      const start = Math.max(end - STEP, particle.birth);
      const simulatedUntil = Math.min(end, particle.burstAt ?? Infinity);
      const fraction = MathUtils.clamp((time - start) / (simulatedUntil - start || STEP), 0, 1);
      visit(particle, fraction, time - particle.birth);
    }
  }
}
