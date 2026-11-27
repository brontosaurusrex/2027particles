import { ExtrudeGeometry, Path, Shape } from 'three/webgpu';
import outlines from './particle-glyphs.json' with { type: 'json' };

const DEPTH = 0.22;
const BEVEL = 0.022;

function trace(path, [start, ...vertices]) {
  path.moveTo(...start);
  for (const vertex of vertices) path.lineTo(...vertex);
  path.closePath();
  return path;
}

export function chipGeometries(beveled = false) {
  const depth = beveled ? DEPTH - BEVEL * 2 : DEPTH;
  const options = beveled ? {
    depth, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelOffset: -BEVEL, bevelSegments: 3,
  } : { depth, bevelEnabled: false };
  return Object.entries(outlines).map(([symbol, faces]) => {
    const shapes = faces.map(([outer, ...holes]) => {
      const shape = trace(new Shape(), outer);
      shape.holes = holes.map(hole => trace(new Path(), hole));
      return shape;
    });
    const geometry = new ExtrudeGeometry(shapes, options);
    geometry.translate(0, 0, -depth / 2);
    geometry.userData.symbol = symbol;
    geometry.userData.faces = faces;
    geometry.userData.depth = DEPTH;
    return geometry;
  });
}
