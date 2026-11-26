import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial, Vector3,
} from 'three/webgpu';
import { attribute, uniform } from 'three/tsl';
import { CAPACITY, STEP, TRAIL_HISTORY } from './simulation.js';
import { colorWithPalette, particleTint } from './palette-color.js';

const MAX_SEGMENTS = 24;

export class MotionTrails {
  constructor() {
    const capacity = CAPACITY * MAX_SEGMENTS * 6;
    this.positions = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.appearance = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.tint = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('trailAppearance', this.appearance);
    geometry.setAttribute('paletteTint', this.tint);
    const material = new MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true,
    });
    const appearance = attribute('trailAppearance', 'vec3');
    material.opacityNode = appearance.x;
    material.colorNode = colorWithPalette(uniform(new Color(0xffb62e).multiplyScalar(2.1)), appearance.z).mul(appearance.y);
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.view = new Vector3();
    this.points = Array.from({ length: MAX_SEGMENTS + 1 }, () => new Vector3());
    this.sides = Array.from({ length: MAX_SEGMENTS }, () => new Vector3());
    this.offsets = Array.from({ length: MAX_SEGMENTS + 1 }, () => new Vector3());
    this.fades = new Float64Array(MAX_SEGMENTS + 1);
    this.count = 0;
  }

  begin(camera, defaults) {
    this.defaults = defaults;
    this.count = 0;
    camera.getWorldDirection(this.view);
  }

  add(particle, head, time, scale, opacity, brightness) {
    const { history, historyNext, historyCount, size, hue: angle = 0, trailLengthJitter = 0 } = particle;
    const { trail = 0, trailWidth = 100, trailLengthVariation = 0 } = particle.style ?? this.defaults;
    const duration = trail / 1000 * (1 + trailLengthVariation / 100 * trailLengthJitter);
    if (!historyCount || duration <= 0 || trailWidth <= 0) return;

    const { points, sides, offsets, fades } = this;
    const cutoff = time - duration;
    const stride = Math.max(1, Math.ceil((duration / STEP + 1) / MAX_SEGMENTS));
    points[0].copy(head);
    fades[0] = 1;
    let count = 0;
    let frontTime = time;
    for (let segment = 0; segment < MAX_SEGMENTS; segment++) {
      const index = Math.min(segment * stride, historyCount - 1);
      const slot = (historyNext - 1 - index + TRAIL_HISTORY) % TRAIL_HISTORY * 4;
      const sampleTime = history[slot + 3];
      if (sampleTime < frontTime) {
        const back = points[count + 1].fromArray(history, slot);
        if (sampleTime < cutoff) back.lerp(points[count], (cutoff - sampleTime) / (frontTime - sampleTime));
        const side = sides[count].subVectors(points[count], back).cross(this.view);
        if (side.lengthSq() > 1e-9) {
          side.normalize();
          fades[++count] = (Math.max(cutoff, sampleTime) - cutoff) / duration;
          frontTime = sampleTime;
        }
      }
      if (sampleTime <= cutoff || index === historyCount - 1) break;
    }
    if (!count) return;
    const width = size * scale * 0.34 * trailWidth / 100;
    const tint = particleTint(particle);
    // Shared, capped miter joins keep adjacent quads together around bends.
    for (let i = 0; i <= count; i++) {
      const before = sides[Math.max(0, i - 1)];
      const after = sides[Math.min(i, count - 1)];
      const offset = offsets[i].addVectors(before, after).normalize();
      if (offset.lengthSq() === 0) offset.copy(after);
      offset.multiplyScalar(width * fades[i] / Math.max(0.5, offset.dot(after)));
      fades[i] = fades[i] ** 1.8 * 0.68 * opacity;
    }
    for (let i = 0; i < count; i++) {
      this.vertex(i, 1, brightness, angle, tint);
      this.vertex(i, -1, brightness, angle, tint);
      this.vertex(i + 1, 1, brightness, angle, tint);
      this.vertex(i + 1, 1, brightness, angle, tint);
      this.vertex(i, -1, brightness, angle, tint);
      this.vertex(i + 1, -1, brightness, angle, tint);
    }
  }

  vertex(sample, direction, brightness, angle, tint) {
    const point = this.points[sample];
    const offset = this.offsets[sample];
    const index = this.count++;
    this.positions.setXYZ(index, point.x + direction * offset.x, point.y + direction * offset.y,
      point.z + direction * offset.z);
    this.appearance.setXYZ(index, this.fades[sample], brightness, angle);
    this.tint.setXYZ(index, ...tint);
  }

  finish() {
    this.mesh.visible = this.count > 0;
    this.mesh.geometry.setDrawRange(0, this.count);
    if (!this.count) return;
    this.positions.addUpdateRange(0, this.count * 3);
    this.positions.needsUpdate = true;
    this.appearance.addUpdateRange(0, this.count * 3);
    this.appearance.needsUpdate = true;
    this.tint.addUpdateRange(0, this.count * 3);
    this.tint.needsUpdate = true;
  }
}
