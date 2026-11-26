import { DEFAULT_BRIGHTNESS } from './lifetime.js';
import {
  EMITTER_LIMIT, FPS, FRAME_COUNT, MAX_DURATION_FRAMES, MAX_TRAIL_MS, MIN_CHIP_SIZE, PALETTES, TRAIL_DEFAULTS,
  emitterSettings, validateStroke,
} from './simulation.js';

const FORMAT = '2027-particles';
const VERSION = 1;
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_FOCAL_LENGTH = 26;
export const FOCAL_LENGTH_BOUNDS = [25, 200];
export const MAX_FOCUS_DISTANCE = 300;

const emitterBounds = {
  rate: [0, 400], lifetime: [0.1, 8], lifetimeVariation: [0, 100], size: [MIN_CHIP_SIZE, 0.3], sizeVariation: [0, 150],
  speed: [0, 10], speedVariation: [0, 200], launchSpread: [0, 200], hueVariation: [0, 180], drawSpeed: [0, 100],
  smoothing: [0, 100], rotationSpeed: [0, 360], rotationVariation: [0, 100], splitChance: [0, 100],
  burstSizeVariation: [0, 100], brightnessVariation: [0, 100], sparkleAmount: [0, 100],
  birthScatter: [0, 1], weldingSparks: [0, 100], trail: [0, MAX_TRAIL_MS], trailWidth: [0, 300],
  trailLengthVariation: [0, 100],
};

const effectBounds = {
  depth: [0, 5], shutter: [0, 360], focus: [0.2, MAX_FOCUS_DISTANCE],
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

function readEmitter(value, legacyTrails) {
  const emitter = object(value, 'emitter');
  const id = integer(emitter.id, 1, Number.MAX_SAFE_INTEGER - 1, 'emitter ID');
  const kind = choice(emitter.kind, ['line', 'outline', 'area'], 'emitter type');
  const primitive = emitter.primitive === undefined ? undefined :
    choice(emitter.primitive, ['curve', 'circle', 'square'], 'emitter shape');
  if (primitive && primitive !== 'curve' && kind === 'line') invalid('emitter shape');
  if (!Array.isArray(emitter.points) || emitter.points.length > 512) invalid('emitter path');
  const limit = primitive === 'curve' ? 90 : 72;
  const points = emitter.points.map(point => vector(point, 2, -limit, limit, 'emitter point'));
  if (validateStroke(kind, points) || !points.some(([x, y]) => x !== points[0][0] || y !== points[0][1])) {
    invalid('emitter path');
  }
  const brightness = vector(emitter.brightness ?? DEFAULT_BRIGHTNESS, DEFAULT_BRIGHTNESS.length, 0, 2, 'brightness curve');
  return {
    id, kind, points,
    muted: boolean(emitter.muted ?? false, 'emitter mute state'),
    ...(primitive ? { primitive } : {}),
    position: vector(emitter.position, 3, primitive === 'curve' ? -40 : -36,
      primitive === 'curve' ? 40 : 36, 'emitter position'),
    rotation: vector(emitter.rotation, 3, -360, 360, 'emitter rotation'),
    ...boundedSettings(emitterSettings({ ...legacyTrails, ...emitter, brightness }), emitterBounds, 'emitter'),
    palette: choice(emitter.palette ?? 'original', Object.keys(PALETTES), 'emitter palette'),
    trailOnly: boolean(emitter.trailOnly ?? false, 'trail only'),
    drawDirection: choice(emitter.drawDirection ?? 'as-drawn',
      ['as-drawn', 'reverse', 'clockwise', 'counterclockwise'], 'draw direction'),
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
  const effects = object(project.effects, 'camera effects');
  const legacyTrails = Object.fromEntries(Object.keys(TRAIL_DEFAULTS).map(key => [key, effects[key] ?? TRAIL_DEFAULTS[key]]));
  const emitters = project.emitters.map(emitter => readEmitter(emitter, legacyTrails));
  const ids = new Set(emitters.map(emitter => emitter.id));
  if (ids.size !== emitters.length) invalid('emitter IDs');
  const selectedEmitterId = project.selectedEmitterId;
  if (emitters.length ? !ids.has(selectedEmitterId) : selectedEmitterId !== null) invalid('selected emitter');
  const soloEmitterId = project.soloEmitterId ?? null;
  if (soloEmitterId !== null && !ids.has(soloEmitterId)) invalid('solo emitter');
  const nextEmitterId = integer(project.nextEmitterId, Math.max(0, ...ids) + 1, Number.MAX_SAFE_INTEGER, 'next emitter ID');

  const forces = object(project.forces, 'forces');
  const camera = object(project.camera, 'camera');
  const editor = object(project.editor, 'editor');
  const playback = object(project.playback, 'playback');
  const durationFrames = integer(playback.durationFrames ?? FRAME_COUNT, 1, MAX_DURATION_FRAMES, 'timeline length');
  const sampling = project.exportDofSampling === undefined ? {} : object(project.exportDofSampling, 'DOF sampling');
  const position = vector(camera.position, 3, -1e9, 1e9, 'camera position');
  const target = vector(camera.target, 3, -1e9, 1e9, 'camera target');
  if (position.every((value, axis) => value === target[axis])) invalid('camera position');

  return {
    emitters, selectedEmitterId, soloEmitterId, nextEmitterId,
    forces: {
      ...boundedSettings(forces, { gravity: [-10, 10], turbulence: [0, 10], drag: [0, 8] }, 'force'),
      wind: vector(forces.wind, 3, -8, 8, 'wind'),
      seed: integer(forces.seed, 0, 4294967295, 'seed'),
    },
    effects: {
      ...boundedSettings(effects, effectBounds, 'camera effect'),
      dofMode: choice(effects.dofMode ?? 'blur', ['blur', 'dim'], 'DOF mode'),
    },
    camera: {
      position, target,
      focalLength: number(camera.focalLength, ...FOCAL_LENGTH_BOUNDS, 'focal length'),
      winter: boolean(camera.winter, 'winter backdrop'),
      black: boolean(camera.black ?? false, 'black preview'),
    },
    editor: {
      mode: choice(editor.mode, ['orbit', 'line', 'outline', 'area'], 'drawing mode'),
      plane: choice(editor.plane, ['xy', 'xz', 'yz', 'camera'], 'drawing plane'),
      planeOffset: number(editor.planeOffset, -12, 12, 'drawing plane offset'),
      drawingShape: choice(editor.drawingShape ?? 'freehand', ['freehand', 'curve', 'circle', 'square'], 'drawing shape'),
      previewQuality: choice(editor.previewQuality ?? 'auto', ['auto', 'full'], 'preview quality'),
      frameRate: choice(editor.frameRate ?? FPS, [25, FPS], 'frame rate'),
    },
    playback: {
      // The cursor and duration use the simulation's fixed 50 fps timebase.
      frame: integer(playback.frame, 1, durationFrames, 'frame'),
      durationFrames,
      loop: boolean(playback.loop, 'loop setting'),
      playing: boolean(playback.playing, 'playback state'),
    },
    exportBackground: choice(project.exportBackground, ['transparent', 'winter', 'black'], 'export background'),
    exportFormat: choice(project.exportFormat ?? 'png', ['png', 'prores', 'cineform'], 'export format'),
    printBackground: choice(project.printBackground ?? 'transparent', ['transparent', 'black'], 'print background'),
    exportDofSampling: {
      print: choice(sampling.print ?? 'full', ['preview', 'full'], 'print DOF sampling'),
      sequence: choice(sampling.sequence ?? 'full', ['preview', 'full'], 'sequence DOF sampling'),
    },
  };
}
