import { Euler, MathUtils, Quaternion, ShapeUtils, Vector2, Vector3 } from 'three/webgpu';
import { DEFAULT_BRIGHTNESS } from './lifetime.js';

export const FPS = 50;
export const FRAME_COUNT = 500;
export const STEP = 1 / FPS;
export const CAPACITY = 2400;
export const EMITTER_LIMIT = 32;
export const MAX_TRAIL_MS = 1200;
export const TRAIL_HISTORY = Math.ceil(MAX_TRAIL_MS / (1000 * STEP)) + 1;
const TAU = 2 * Math.PI;
const DEFAULT_ROTATION_SPEED = 180;
const DEFAULT_ROTATION_VARIATION = 50;

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
    rate = 115, lifetime = 2.4, size = 0.085, sizeVariation = 100, speed = 2.6,
    speedVariation = 25, hueVariation = 0, drawSpeed = 25, smoothing = 0, brightness = DEFAULT_BRIGHTNESS,
    rotationSpeed = DEFAULT_ROTATION_SPEED, rotationVariation = DEFAULT_ROTATION_VARIATION,
  } = source;
  return {
    rate, lifetime, size, sizeVariation, speed, speedVariation, hueVariation, drawSpeed, smoothing,
    rotationSpeed, rotationVariation, brightness: [...brightness],
  };
}

export function createEmitter(id, kind, points, position = [0, 0, 0], rotation = [0, 0, 0], source) {
  return { id, kind, points, position, rotation, ...emitterSettings(source) };
}

export function strokeDuration(emitter) {
  return emitter.kind !== 'area' && emitter.drawSpeed > 0 ? 100 / emitter.drawSpeed : Infinity;
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

export function strokePath({ kind, points, smoothing = 0 }) {
  const closed = kind !== 'line';
  const path = smoothStroke(points, closed, kind === 'area' ? 0 : smoothing);
  const vertices = closed ? [...path, path[0]] : path;
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
  const path = kind === 'area' ? null : strokePath(emitter);
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
    sample(random, progress) {
      if (path) {
        const { x, y } = positionOnStroke(path, progress ?? random());
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

export class Simulation {
  constructor(settings, emitters, shapeCount) {
    this.settings = settings;
    this.emitters = emitters.map(emitter => ({ ...emitter, ...emitterSampler(emitter), drawDuration: strokeDuration(emitter) }));
    this.shapeCount = shapeCount;
    this.reset();
  }

  reset() {
    this.frame = 0;
    this.particles = [];
    this.random = randomSource(this.settings.seed);
    this.hueRandom = randomSource(this.settings.seed ^ 0x9e3779b9);
    this.rotationRandom = randomSource(this.settings.seed ^ 0xc2b2ae35);
  }

  seek(frame) {
    if (frame < this.frame) this.reset();
    while (this.frame < frame) this.step();
  }

  step() {
    const start = this.frame * STEP;
    const end = ++this.frame * STEP;
    const { gravity, wind, turbulence, drag = 0 } = this.settings;
    const random = this.random;
    this.particles = this.particles.filter(particle => particle.death > start);

    for (const emitter of this.emitters) {
      const { drawDuration } = emitter;
      if (start >= drawDuration) continue;
      const sizeVariation = (emitter.sizeVariation ?? 100) / 100;
      const hueRange = MathUtils.degToRad(emitter.hueVariation ?? 0);
      const rotationSpeed = MathUtils.degToRad(emitter.rotationSpeed ?? DEFAULT_ROTATION_SPEED);
      const rotationVariation = (emitter.rotationVariation ?? DEFAULT_ROTATION_VARIATION) / 100;
      const first = Math.floor(start * emitter.rate + 1e-8) + 1;
      const last = Math.floor(Math.min(end, drawDuration) * emitter.rate + 1e-8);
      for (let i = first; i <= last && this.particles.length < CAPACITY; i++) {
        const birth = Math.max(start, (i - 0.5) / emitter.rate);
        const progress = Number.isFinite(drawDuration) ? birth / drawDuration : undefined;
        const position = emitter.sample(random, progress);
        const angle = TAU * random();
        const outward = 0.34 + 0.66 * random();
        const velocity = new Vector3(Math.cos(angle) * outward, Math.sin(angle) * outward, 0)
          .addScaledVector(emitter.normal, 0.15 + 0.75 * random())
          .add(new Vector3(0, 0.66, 0));
        const variation = emitter.speedVariation > 0 ? (2 * random() - 1) * emitter.speedVariation / 100 : 0;
        velocity.multiplyScalar(emitter.speed * (1 + variation));
        this.particles.push({
          birth,
          death: birth + emitter.lifetime * (0.72 + 0.56 * random()),
          brightness: emitter.brightness ?? DEFAULT_BRIGHTNESS,
          position,
          previous: position.clone(),
          velocity,
          history: new Float32Array(TRAIL_HISTORY * 4),
          historyNext: 0,
          historyCount: 0,
          rotation: [TAU * random(), TAU * random(), TAU * random()],
          spin: particleSpin(random, rotationSpeed * (1 + (2 * this.rotationRandom() - 1) * rotationVariation)),
          size: emitter.size * MathUtils.lerp(1, 0.38 + 0.95 * random() ** 2, sizeVariation),
          phase: random() * TAU,
          flashRate: 6 + 14 * random(),
          glint: random() < 0.46,
          shape: Math.floor(random() * this.shapeCount),
          shade: Math.floor(random() * 5),
          hue: (this.hueRandom() * 2 - 1) * hueRange,
        });
      }
    }

    for (const particle of this.particles) {
      const { position, previous, velocity, birth, phase } = particle;
      const sampleTime = Math.max(start, birth);
      const duration = end - sampleTime;
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
      velocity.x += (wind[0] + turbulence * Math.sin(position.y * 1.4 + start * 2.5 + phase)) * forceTime;
      velocity.y += (wind[1] - gravity + turbulence * Math.sin(position.z * 1.8 - start * 1.8 + phase * 2)) * forceTime;
      velocity.z += (wind[2] + turbulence * Math.sin(position.x * 1.7 + start * 1.9 - phase)) * forceTime;
      position.addScaledVector(velocity, duration);
    }
  }

  sample(time, visit) {
    const end = this.frame * STEP;
    for (const particle of this.particles) {
      if (time < particle.birth || time >= particle.death) continue;
      const start = Math.max(end - STEP, particle.birth);
      const fraction = MathUtils.clamp((time - start) / (end - start || STEP), 0, 1);
      visit(particle, fraction, time - particle.birth);
    }
  }
}
