import { CanvasTexture, ExtrudeGeometry, Path, Shape } from 'three/webgpu';
import outlines from './particle-glyphs.json' with { type: 'json' };
import { randomSource } from './simulation.js';

const DEPTH = 0.22;

export function scratchHeightMap() {
  const map = document.createElement('canvas');
  map.width = map.height = 512;
  const context = map.getContext('2d');
  const random = randomSource(0x38ac057);
  context.fillStyle = '#808080';
  context.fillRect(0, 0, map.width, map.height);
  context.lineCap = 'round';

  for (let i = 0; i < 30; i++) {
    const x = random() * map.width;
    const y = random() * map.height;
    const length = 20 + random() * 135;
    const angle = (random() - 0.5) * 0.64;
    const dx = Math.cos(angle) * length;
    const dy = Math.sin(angle) * length;
    context.strokeStyle = `rgba(0, 0, 0, ${0.12 + random() * 0.30})`;
    context.lineWidth = 0.65 + random() * 0.55;
    context.beginPath();
    context.moveTo(x, y);
    context.quadraticCurveTo(x + dx / 2, y + dy / 2 + (random() - 0.5) * 5, x + dx, y + dy);
    context.stroke();
  }

  return new CanvasTexture(map);
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
