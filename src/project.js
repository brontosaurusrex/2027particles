import { DEFAULT_BRIGHTNESS } from './lifetime.js';
import { EMITTER_LIMIT, FPS, FRAME_COUNT, MAX_TRAIL_MS, emitterSettings, validateStroke } from './simulation.js';

const FORMAT = '2027-particles';
const VERSION = 1;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_FOCAL_LENGTH = 26;
export const FOCAL_LENGTH_BOUNDS = [25, 200];
export const MAX_FOCUS_DISTANCE = 300;

const emitterBounds = {
  rate: [0, 400], lifetime: [0.1, 8], size: [0.02, 0.3], sizeVariation: [0, 150],
  speed: [0, 10], speedVariation: [0, 100], hueVariation: [0, 180], drawSpeed: [0, 100],
  smoothing: [0, 100], rotationSpeed: [0, 360], rotationVariation: [0, 100], splitChance: [0, 100],
};

const effectBounds = {
  depth: [0, 5], shutter: [0, 360], focus: [0.2, MAX_FOCUS_DISTANCE], trail: [0, MAX_TRAIL_MS],
  trailWidth: [0, 300], trailLengthVariation: [0, 100],
};

function invalid(field) {
  throw new Error(`Invalid ${field} in the project file.`);
}

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value;
}

function number(value, min, max, field) {
  if (!Number.isFinite(value) || value < min || value > max) invalid(field);
  return value;
}

function integer(value, min, max, field) {
  if (!Number.isInteger(value)) invalid(field);
  return number(value, min, max, field);
}

function boolean(value, field) {
  if (typeof value !== 'boolean') invalid(field);
  return value;
}

function choice(value, options, field) {
  if (!options.includes(value)) invalid(field);
  return value;
}

function vector(value, length, min, max, field) {
  if (!Array.isArray(value) || value.length !== length) invalid(field);
  return value.map(element => number(element, min, max, field));
}

function boundedSettings(value, bounds, label) {
  return Object.fromEntries(Object.entries(bounds).map(([key, [min, max]]) =>
    [key, number(value[key], min, max, `${label} ${key}`)]));
}

function readEmitter(value) {
  const emitter = object(value, 'emitter');
  const id = integer(emitter.id, 1, Number.MAX_SAFE_INTEGER - 1, 'emitter ID');
  const kind = choice(emitter.kind, ['line', 'outline', 'area'], 'emitter type');
  if (!Array.isArray(emitter.points) || emitter.points.length > 512) invalid('emitter path');
  const points = emitter.points.map(point => vector(point, 2, -72, 72, 'emitter point'));
  if (validateStroke(kind, points) || !points.some(([x, y]) => x !== points[0][0] || y !== points[0][1])) {
    invalid('emitter path');
  }
  const brightness = vector(emitter.brightness ?? DEFAULT_BRIGHTNESS, DEFAULT_BRIGHTNESS.length, 0, 2, 'brightness curve');
  return {
    id, kind, points,
    position: vector(emitter.position, 3, -36, 36, 'emitter position'),
    rotation: vector(emitter.rotation, 3, -360, 360, 'emitter rotation'),
    ...boundedSettings(emitterSettings({ ...emitter, brightness }), emitterBounds, 'emitter'),
    brightness,
  };
}

export function encodeProject(project) {
  return JSON.stringify({ format: FORMAT, version: VERSION, ...project }, null, 2) + '\n';
}

export async function readProject(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('Project file exceeds 4 MB.');
  const contents = await file.text();
  return decodeProject(contents);
}

export function decodeProject(contents) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('Could not read the project JSON.');
  }
  const project = object(parsed, 'project');
  if (project.format !== FORMAT || project.version !== VERSION) {
    throw new Error('Unsupported 2027 Particles project format.');
  }

  if (!Array.isArray(project.emitters) || project.emitters.length > EMITTER_LIMIT) invalid('emitters');
  const emitters = project.emitters.map(readEmitter);
  const ids = new Set(emitters.map(emitter => emitter.id));
  if (ids.size !== emitters.length) invalid('emitter IDs');
  const selectedEmitterId = project.selectedEmitterId;
  if (emitters.length ? !ids.has(selectedEmitterId) : selectedEmitterId !== null) invalid('selected emitter');
  const nextEmitterId = integer(project.nextEmitterId, Math.max(0, ...ids) + 1, Number.MAX_SAFE_INTEGER, 'next emitter ID');

  const forces = object(project.forces, 'forces');
  const effects = object(project.effects, 'camera effects');
  const camera = object(project.camera, 'camera');
  const editor = object(project.editor, 'editor');
  const playback = object(project.playback, 'playback');
  const position = vector(camera.position, 3, -1e9, 1e9, 'camera position');
  const target = vector(camera.target, 3, -1e9, 1e9, 'camera target');
  if (position.every((value, axis) => value === target[axis])) invalid('camera position');

  return {
    emitters, selectedEmitterId, nextEmitterId,
    forces: {
      ...boundedSettings(forces, { gravity: [-10, 10], turbulence: [0, 10], drag: [0, 8] }, 'force'),
      wind: vector(forces.wind, 3, -8, 8, 'wind'),
      seed: integer(forces.seed, 0, 4294967295, 'seed'),
    },
    effects: boundedSettings(effects, effectBounds, 'camera effect'),
    camera: {
      position, target,
      focalLength: number(camera.focalLength, ...FOCAL_LENGTH_BOUNDS, 'focal length'),
      winter: boolean(camera.winter, 'winter backdrop'),
    },
    editor: {
      mode: choice(editor.mode, ['orbit', 'line', 'outline', 'area'], 'drawing mode'),
      plane: choice(editor.plane, ['xy', 'xz', 'yz'], 'drawing plane'),
      planeOffset: number(editor.planeOffset, -12, 12, 'drawing plane offset'),
      previewQuality: choice(editor.previewQuality ?? 'auto', ['auto', 'full'], 'preview quality'),
      frameRate: choice(editor.frameRate ?? FPS, [25, FPS], 'frame rate'),
    },
    playback: {
      frame: integer(playback.frame, 1, FRAME_COUNT, 'frame'),
      loop: boolean(playback.loop, 'loop setting'),
      playing: boolean(playback.playing, 'playback state'),
    },
    exportBackground: choice(project.exportBackground, ['transparent', 'winter'], 'export background'),
  };
}
