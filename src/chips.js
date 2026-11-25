import { ExtrudeGeometry, Path, Shape } from 'three/webgpu';
import outlines from './particle-glyphs.json' with { type: 'json' };

const DEPTH = 0.22;

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
