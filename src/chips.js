import { ExtrudeGeometry, Shape } from 'three/webgpu';
import { randomSource } from './simulation.js';

const TAU = 2 * Math.PI;
const VARIANTS = 48;

// Contour families and probabilities adapted from Physical's buildDebrisShape.
export function chipGeometries() {
  const random = randomSource(917023);
  const between = (low, high) => low + (high - low) * random();
  const integer = (low, high) => Math.floor(between(low, high + 1));
  const geometries = [];

  for (let variant = 0; variant < VARIANTS; variant++) {
    let width = between(0.74, 1);
    let height = between(0.72, 0.98);
    if (width > height * 1.45) width = height * between(1, 1.45);
    if (height > width * 1.45) height = width * between(1, 1.45);
    const roll = (variant + 0.5) / VARIANTS;
    const rotation = between(-Math.PI, Math.PI);
    const radial = (count, min, max, jitter, scale = () => 1) => Array.from({ length: count }, (_, index) => {
      const angle = rotation + index * TAU / count + between(-jitter, jitter);
      const radius = between(min, max) * scale(index);
      return [Math.cos(angle) * width * radius, Math.sin(angle) * height * radius];
    });

    let points;
    let roundness = 0;
    const shape = new Shape();
    if (roll < 0.18) {
      const radius = Math.min(width, height) * between(0.72, 0.96);
      shape.absarc(0, 0, radius, 0, TAU);
    } else if (roll < 0.32) {
      points = radial(3, 0.72, 1.06, 0.12);
      roundness = between(0, 0.04);
    } else if (roll < 0.38) {
      const corners = integer(4, 7) * 2;
      const inner = between(0.34, 0.62);
      points = radial(corners, 0.86, 1.08, TAU / corners * 0.16,
        index => index % 2 ? inner * between(0.88, 1.12) : 1);
      roundness = between(0, 0.025);
    } else if (roll < 0.58) {
      const corners = integer(7, 14);
      points = radial(corners, 0.48, 1.10, TAU / corners * 0.28);
    } else if (roll < 0.595) {
      if (random() < 0.5) width *= between(0.36, 0.58);
      else height *= between(0.36, 0.58);
      points = radial(integer(3, 4), 0.68, 1.05, 0.16);
      roundness = between(0, 0.05);
    } else if (roll < 0.595 + 0.405 * 0.30) {
      points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) =>
        [(x + between(-0.22, 0.22)) * width, (y + between(-0.24, 0.24)) * height]);
      roundness = between(0.02, 0.12);
    } else if (roll < 0.595 + 0.405 * 0.68) {
      points = radial(integer(4, 7), 0.62, 1.05, 0.18);
      roundness = between(0.04, 0.18);
    } else {
      const x = width;
      const y = height;
      const cutX = x * between(0.28, 0.45);
      const cutY = y * between(0.28, 0.45);
      points = [[-x + cutX, -y], [x - cutX, -y], [x, -y + cutY], [x, y - cutY],
        [x - cutX, y], [-x + cutX, y], [-x, y - cutY], [-x, -y + cutY]].map(([px, py]) =>
        [px + x * between(-0.06, 0.06), py + y * between(-0.07, 0.07)]);
      roundness = between(0.58, 0.82);
    }

    if (points) traceContour(shape, points, roundness);
    const geometry = new ExtrudeGeometry(shape, {
      depth: between(0.14, 0.32), bevelEnabled: false, curveSegments: 4,
    });
    geometry.center();
    geometries.push(geometry);
  }
  return geometries;
}

function traceContour(shape, points, roundness) {
  if (roundness <= 0.001) {
    shape.moveTo(...points[0]);
    for (const point of points.slice(1)) shape.lineTo(...point);
  } else {
    const fraction = 0.08 + roundness * 0.34;
    const towards = (a, b) => [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
    shape.moveTo(...towards(points[0], points.at(-1)));
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      shape.quadraticCurveTo(...point, ...towards(point, next));
      shape.lineTo(...towards(next, point));
    });
  }
  shape.closePath();
}
