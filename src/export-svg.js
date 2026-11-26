import { Color, Matrix4, Vector3 } from 'three/webgpu';
import { WIDTH, HEIGHT } from './renderer.js';
import { STEP } from './simulation.js';
import { tintVectorColor } from './palette-color.js';

const keyLight = new Vector3(-4, 6, 4).normalize();
const rimLight = new Vector3(5, 1, -4).normalize();
const trailGold = new Color(0xffb62e);
const glintGold = new Color(0xffd070);
const coordinate = value => value.toFixed(2);
const alpha = value => value.toFixed(3);
const pathData = points => 'M' + points.map(({ x, y }) => `${coordinate(x)},${coordinate(y)}`).join('L') + 'Z';

// Match Three's TSL hue rotation around the neutral RGB axis.
function rotateHue(color, angle) {
  if (!angle) return color;
  const { r, g, b } = color;
  const cosine = Math.cos(angle);
  const cross = Math.sin(angle) / Math.sqrt(3);
  const neutral = (r + g + b) * (1 - cosine) / 3;
  return color.setRGB(
    Math.max(0, r * cosine + (b - g) * cross + neutral),
    Math.max(0, g * cosine + (r - b) * cross + neutral),
    Math.max(0, b * cosine + (g - r) * cross + neutral),
  );
}

function clipAtDepth(points, plane, within) {
  const clipped = [];
  for (let index = 0; index < points.length; index++) {
    const end = points[index];
    const start = points[(index - 1 + points.length) % points.length];
    if (within(start.z) !== within(end.z)) {
      clipped.push(start.clone().lerp(end, (plane - start.z) / (end.z - start.z)));
    }
    if (within(end.z)) clipped.push(end);
  }
  return clipped;
}

function project(point, camera) {
  const projected = point.clone().applyMatrix4(camera.projectionMatrix);
  projected.x = (projected.x + 1) * WIDTH / 2;
  projected.y = (1 - projected.y) * HEIGHT / 2;
  return projected;
}

function projectPolygon(points, camera) {
  let visible = clipAtDepth(points, -camera.near, z => z <= -camera.near);
  visible = clipAtDepth(visible, -camera.far, z => z >= -camera.far);
  if (visible.length < 3) return null;
  const projected = visible.map(point => project(point, camera));
  if (projected.every(point => point.x < 0) || projected.every(point => point.x > WIDTH) ||
      projected.every(point => point.y < 0) || projected.every(point => point.y > HEIGHT)) return null;
  return projected;
}

function chipFaces(faces, halfDepth, objectToWorld, objectToView, camera, color, brightness) {
  const cameraLocal = new Vector3().setFromMatrixPosition(camera.matrixWorld)
    .applyMatrix4(objectToWorld.clone().invert());
  const shade = normal => {
    normal.transformDirection(objectToWorld);
    const lighting = 0.53 + 0.68 * Math.max(0, normal.dot(keyLight)) + 0.31 * Math.max(0, normal.dot(rimLight));
    return color.clone().multiplyScalar(brightness * lighting).getHexString();
  };
  const projectFace = points => {
    const face = projectPolygon(points.map(point => new Vector3(...point).applyMatrix4(objectToView)), camera);
    return face ? pathData(face) : '';
  };
  const paths = [];
  for (const contours of faces) {
    for (const contour of contours) {
      contour.forEach(([x, y], index) => {
        const [nextX, nextY] = contour[(index + 1) % contour.length];
        // Outer loops are counterclockwise and holes are clockwise.
        const normal = new Vector3(nextY - y, x - nextX, 0);
        if (normal.x * (cameraLocal.x - x) + normal.y * (cameraLocal.y - y) <= 0) return;
        const path = projectFace([[x, y, -halfDepth], [nextX, nextY, -halfDepth],
          [nextX, nextY, halfDepth], [x, y, halfDepth]]);
        if (path) paths.push(`<path fill="#${shade(normal)}" d="${path}"/>`);
      });
    }
    if (Math.abs(cameraLocal.z) <= halfDepth) continue;
    const side = Math.sign(cameraLocal.z);
    const [outer, ...holes] = contours.map(contour =>
      projectFace(contour.map(([x, y]) => [x, y, side * halfDepth])));
    if (outer) {
      const fill = shade(new Vector3(0, 0, side));
      paths.push(`<path fill="#${fill}" fill-rule="evenodd" d="${outer}${holes.join('')}"/>`);
    }
  }
  return paths.join('');
}

function vectorParticles(batches, camera, glints = false) {
  const groups = [];
  const world = new Matrix4();
  const view = new Matrix4();
  const color = new Color();
  for (const batch of batches) {
    const { outline, faces, symbol } = batch.geometry.userData;
    const halfDepth = glints ? 0 : batch.geometry.parameters.options.depth / 2;
    const appearance = batch.geometry.attributes.lifetimeAppearance;
    for (let index = 0; index < batch.count; index++) {
      const opacity = appearance.getX(index);
      if (opacity < 0.0005) continue;
      const brightness = appearance.getY(index);
      const angle = appearance.getZ(index);
      batch.getMatrixAt(index, world);
      view.multiplyMatrices(camera.matrixWorldInverse, world);
      batch.getColorAt(index, color);
      let contents;
      if (glints) {
        const shape = projectPolygon(outline.map(([x, y]) => new Vector3(x, y, 0).applyMatrix4(view)), camera);
        if (!shape) continue;
        const tinted = tintVectorColor(color.multiply(glintGold), batch.geometry.attributes.paletteTint, index);
        const fill = rotateHue(tinted, angle).multiplyScalar(brightness * 0.65).getHexString();
        contents = `<path fill="#${fill}" d="${pathData(shape)}"/>`;
      } else {
        const tinted = tintVectorColor(color, batch.geometry.attributes.paletteTint, index);
        contents = chipFaces(faces, halfDepth, world, view, camera, rotateHue(tinted, angle), brightness);
      }
      const shape = symbol ? ` data-shape="${symbol}"` : '';
      if (contents) groups.push({ z: view.elements[14], svg: `<g${shape} opacity="${alpha(opacity)}">${contents}</g>` });
    }
  }
  return groups.sort((a, b) => a.z - b.z).map(group => group.svg).join('\n');
}

function vectorTrails(trails, camera) {
  const gradients = [];
  const paths = [];
  for (let index = 0; index < trails.count; index += 6) {
    const frontAlpha = trails.appearance.getX(index);
    const backAlpha = trails.appearance.getX(index + 2);
    if (frontAlpha < 0.0005) continue;
    const corners = [0, 1, 5, 2].map(offset =>
      new Vector3().fromBufferAttribute(trails.positions, index + offset).applyMatrix4(camera.matrixWorldInverse));
    const path = projectPolygon(corners, camera);
    if (!path) continue;
    const brightness = trails.appearance.getY(index);
    const color = rotateHue(tintVectorColor(trailGold.clone(), trails.tint, index), trails.appearance.getZ(index))
      .multiplyScalar(brightness * 1.45).getHexString();
    if (corners.some(point => point.z > -camera.near || point.z < -camera.far)) {
      paths.push(`<path fill="#${color}" opacity="${alpha((frontAlpha + backAlpha) / 2)}" d="${pathData(path)}"/>`);
      continue;
    }
    const front = project(corners[0].clone().lerp(corners[1], 0.5), camera);
    const back = project(corners[2].clone().lerp(corners[3], 0.5), camera);
    const id = `trail-${gradients.length + 1}`;
    gradients.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${coordinate(front.x)}" y1="${coordinate(front.y)}" x2="${coordinate(back.x)}" y2="${coordinate(back.y)}"><stop offset="0" stop-color="#${color}" stop-opacity="${alpha(frontAlpha)}"/><stop offset="1" stop-color="#${color}" stop-opacity="${alpha(backAlpha)}"/></linearGradient>`);
    paths.push(`<path fill="url(#${id})" d="${pathData(path)}"/>`);
  }
  return { gradients: gradients.join('\n'), paths: paths.join('\n') };
}

export function renderVectorFrame(view, simulation, frame, camera, effects, frameNumber = frame) {
  camera.updateMatrixWorld(true);
  simulation.seek(frame);
  view.updateInstances(simulation, frame * STEP, camera, effects);
  const trails = vectorTrails(view.trails, camera);
  const chips = vectorParticles(view.chips, camera);
  const glints = vectorParticles([view.sparks], camera, true);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<title>2027 Particles, frame ${frameNumber}</title>
<defs>
<clipPath id="frame"><rect width="${WIDTH}" height="${HEIGHT}"/></clipPath>
${trails.gradients}
</defs>
<g clip-path="url(#frame)">
<g id="trails">${trails.paths}</g>
<g id="chips">${chips}</g>
<g id="glints">${glints}</g>
</g>
</svg>`;
}
