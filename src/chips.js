import { DataTexture, ExtrudeGeometry, LinearFilter, Path, Shape } from 'three/webgpu';
import outlines from './particle-glyphs.json' with { type: 'json' };
import { randomSource } from './simulation.js';

const DEPTH = 0.22;
export const SCRATCH_MAP_SIZE = 256;
export const SCRATCH_DISTANCE_LIMIT = 16;

export function scratchNormalMap() {
  const size = SCRATCH_MAP_SIZE;
  const limit = SCRATCH_DISTANCE_LIMIT;
  const distances = new Float32Array(size * size).fill(limit);
  const random = randomSource(0x38ac057);

  for (let i = 0; i < 42; i++) {
    const x = random() * size;
    const y = random() * size;
    const length = 12 + random() * 57;
    const lengthSquared = length * length;
    const angle = (random() - 0.5) * 0.9;
    const dx = Math.cos(angle) * length;
    const dy = Math.sin(angle) * length;
    const radius = 0.55 + random() * 0.4;
    const margin = limit + radius;
    const left = Math.max(0, Math.floor(x - margin));
    const right = Math.min(size - 1, Math.ceil(x + dx + margin));
    const top = Math.max(0, Math.floor(y + Math.min(0, dy) - margin));
    const bottom = Math.min(size - 1, Math.ceil(y + Math.max(0, dy) + margin));
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        const along = ((col - x) * dx + (row - y) * dy) / lengthSquared;
        const t = Math.max(0, Math.min(1, along));
        const distance = Math.hypot(col - x - t * dx, row - y - t * dy) - radius;
        const index = row * size + col;
        distances[index] = Math.min(distances[index], distance);
      }
    }
  }

  const pixels = new Uint8Array(size * size * 4);
  const height = (x, y) => {
    const col = Math.max(0, Math.min(size - 1, x));
    const row = Math.max(0, Math.min(size - 1, y));
    return Math.min(0, distances[row * size + col]);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      const dx = height(x - 1, y) - height(x + 1, y);
      const dy = height(x, y - 1) - height(x, y + 1);
      const normalZ = 1 / Math.hypot(dx, dy, 1);
      pixels[index * 4] = Math.round(128 + dx * normalZ * 127);
      pixels[index * 4 + 1] = Math.round(128 + dy * normalZ * 127);
      pixels[index * 4 + 2] = Math.round(128 + normalZ * 127);
      // Store signed distance alongside the normal so thin grooves can be filtered in screen space.
      pixels[index * 4 + 3] = Math.round((distances[index] + 1) / (limit + 1) * 255);
    }
  }

  const map = new DataTexture(pixels, size, size);
  map.minFilter = map.magFilter = LinearFilter;
  map.needsUpdate = true;
  return map;
}

function trace(path, [start, ...vertices]) {
  path.moveTo(...start);
  for (const vertex of vertices) path.lineTo(...vertex);
  path.closePath();
  return path;
}

export function chipGeometries() {
  return Object.entries(outlines).map(([symbol, faces]) => {
    const shapes = faces.map(([outer, ...holes]) => {
      const shape = trace(new Shape(), outer);
      shape.holes = holes.map(hole => trace(new Path(), hole));
      return shape;
    });
    const geometry = new ExtrudeGeometry(shapes, { depth: DEPTH, bevelEnabled: false });
    geometry.translate(0, 0, -DEPTH / 2);
    geometry.userData.symbol = symbol;
    geometry.userData.faces = faces;
    return geometry;
  });
}
