import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial, Vector3,
} from 'three/webgpu';
import { attribute, uniform } from 'three/tsl';
import { CAPACITY } from './simulation.js';
import { colorWithPalette, particleTint } from './palette-color.js';
import { TrailCurve, TRAIL_SEGMENT_LIMIT } from './trail-curve.js';

export class MotionTrails {
  constructor() {
    const capacity = CAPACITY * (TRAIL_SEGMENT_LIMIT + 1) * 2;
    this.positions = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.appearance = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.tint = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.indices = new BufferAttribute(new Uint32Array(CAPACITY * TRAIL_SEGMENT_LIMIT * 6), 1).setUsage(DynamicDrawUsage);
    this.ribbonStarts = new Uint32Array(CAPACITY + 1);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('trailAppearance', this.appearance);
    geometry.setAttribute('paletteTint', this.tint);
    geometry.setIndex(this.indices);
    const material = new MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true,
    });
    const appearance = attribute('trailAppearance', 'vec3');
    material.opacityNode = appearance.x;
    material.colorNode = colorWithPalette(uniform(new Color(0xffb62e).multiplyScalar(2.1)), appearance.z).mul(appearance.y);
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.curve = new TrailCurve();
    this.view = new Vector3();
    this.sides = Array.from({ length: TRAIL_SEGMENT_LIMIT }, () => new Vector3());
    this.offset = new Vector3();
    this.count = 0;
  }

  begin(camera, defaults, width, height) {
    this.defaults = defaults;
    this.count = this.vertexCount = this.ribbonCount = 0;
    camera.getWorldDirection(this.view);
    this.curve.setCamera(camera, width, height);
  }

  add(particle, head, time, scale, opacity, brightness, style = particle.style ?? this.defaults, angle = particle.hue ?? 0) {
    const { historyCount, size, trailLengthJitter = 0, trailWidthJitter = 0 } = particle;
    const { trail = 0, trailWidth = 100, trailLengthVariation = 0, trailWidthVariation = 0 } = style;
    const widthScale = trailWidth * (1 + trailWidthVariation / 100 * trailWidthJitter);
    const duration = trail / 1000 * (1 + trailLengthVariation / 100 * trailLengthJitter);
    if (!historyCount || duration <= 0 || widthScale <= 0) return;

    const { curve, sides, offset } = this;
    const segments = curve.tessellate(particle, head, time, duration);
    if (!segments) return;
    const { samples, fades } = curve;
    let firstSide = -1;
    for (let i = 0; i < segments; i++) {
      const side = sides[i].subVectors(samples[i], samples[i + 1]).cross(this.view);
      if (side.lengthSq() > 1e-9) {
        side.normalize();
        if (firstSide < 0) firstSide = i;
        else if (side.dot(sides[i - 1]) < 0) side.negate();
      } else if (firstSide >= 0) {
        side.copy(sides[i - 1]);
      }
    }
    if (firstSide < 0) return;
    for (let i = 0; i < firstSide; i++) sides[i].copy(sides[firstSide]);

    const start = this.vertexCount;
    const width = size * scale * 0.34 * widthScale / 100;
    const tint = particleTint(particle);
    this.ribbonStarts[this.ribbonCount++] = start;
    // Both triangles at each join share the same positions and opacity.
    for (let i = 0; i <= segments; i++) {
      const before = sides[Math.max(0, i - 1)];
      const after = sides[Math.min(i, segments - 1)];
      offset.addVectors(before, after).normalize();
      if (offset.lengthSq() === 0) offset.copy(after);
      offset.multiplyScalar(width * fades[i] / Math.max(0.5, offset.dot(after)));
      const fade = fades[i] ** 1.8 * 0.68 * opacity;
      this.vertex(samples[i], 1, fade, brightness, angle, tint);
      this.vertex(samples[i], -1, fade, brightness, angle, tint);
    }
    const indices = this.indices.array;
    for (let i = 0; i < segments; i++) {
      const vertex = start + i * 2;
      indices[this.count++] = vertex;
      indices[this.count++] = vertex + 1;
      indices[this.count++] = vertex + 2;
      indices[this.count++] = vertex + 2;
      indices[this.count++] = vertex + 1;
      indices[this.count++] = vertex + 3;
    }
  }

  vertex(point, sign, opacity, brightness, angle, tint) {
    const index = this.vertexCount++;
    const { x, y, z } = this.offset;
    this.positions.setXYZ(index, point.x + sign * x, point.y + sign * y, point.z + sign * z);
    this.appearance.setXYZ(index, opacity, brightness, angle);
    this.tint.setXYZ(index, ...tint);
  }

  finish() {
    this.ribbonStarts[this.ribbonCount] = this.vertexCount;
    this.mesh.visible = this.count > 0;
    this.mesh.geometry.setDrawRange(0, this.count);
    if (!this.count) return;
    this.indices.addUpdateRange(0, this.count);
    this.indices.needsUpdate = true;
    for (const attribute of [this.positions, this.appearance, this.tint]) {
      attribute.addUpdateRange(0, this.vertexCount * 3);
      attribute.needsUpdate = true;
    }
  }
}
