import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial, Vector3,
} from 'three/webgpu';
import { attribute, hue, uniform } from 'three/tsl';
import { CAPACITY, STEP, TRAIL_HISTORY } from './simulation.js';

const MAX_SEGMENTS = 24;

export class MotionTrails {
  constructor() {
    const capacity = CAPACITY * MAX_SEGMENTS * 6;
    this.positions = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.appearance = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('trailAppearance', this.appearance);
    const material = new MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true,
    });
    const appearance = attribute('trailAppearance', 'vec3');
    material.opacityNode = appearance.x;
    material.colorNode = hue(uniform(new Color(0xffb62e).multiplyScalar(2.1)), appearance.z).mul(appearance.y);
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.view = new Vector3();
    this.front = new Vector3();
    this.back = new Vector3();
    this.side = new Vector3();
    this.count = 0;
  }

  begin(camera, duration) {
    this.duration = duration;
    this.historyStride = Math.max(1, Math.ceil((duration / STEP + 1) / MAX_SEGMENTS));
    this.mesh.visible = duration > 0;
    this.count = 0;
    if (this.mesh.visible) camera.getWorldDirection(this.view);
  }

  add(particle, head, time, scale, opacity, brightness) {
    const { history, historyNext, historyCount, size, hue: angle = 0 } = particle;
    if (!this.mesh.visible || !historyCount) return;
    const cutoff = time - this.duration;
    this.front.copy(head);
    let frontTime = time;
    const width = size * scale * 0.34;
    for (let segment = 0; segment < MAX_SEGMENTS; segment++) {
      const index = Math.min(segment * this.historyStride, historyCount - 1);
      const slot = (historyNext - 1 - index + TRAIL_HISTORY) % TRAIL_HISTORY * 4;
      const sampleTime = history[slot + 3];
      if (sampleTime < frontTime) {
        this.back.fromArray(history, slot);
        const backTime = Math.max(cutoff, sampleTime);
        if (sampleTime < cutoff) this.back.lerp(this.front, (cutoff - sampleTime) / (frontTime - sampleTime));
        const frontFade = (frontTime - cutoff) / this.duration;
        const backFade = (backTime - cutoff) / this.duration;
        this.segment(width, frontFade, backFade, opacity, brightness, angle);
        if (backTime === cutoff) break;
        this.front.copy(this.back);
        frontTime = backTime;
      }
      if (index === historyCount - 1) break;
    }
  }

  segment(width, frontFade, backFade, opacity, brightness, angle) {
    const { view, front, back, side } = this;
    side.subVectors(front, back).cross(view);
    if (side.lengthSq() < 0.0000001) return;
    side.normalize();
    const frontWidth = width * frontFade;
    const backWidth = width * backFade;
    const frontAlpha = frontFade ** 1.8 * 0.68 * opacity;
    const backAlpha = backFade ** 1.8 * 0.68 * opacity;
    this.vertex(front, frontWidth, frontAlpha, brightness, angle);
    this.vertex(front, -frontWidth, frontAlpha, brightness, angle);
    this.vertex(back, backWidth, backAlpha, brightness, angle);
    this.vertex(back, backWidth, backAlpha, brightness, angle);
    this.vertex(front, -frontWidth, frontAlpha, brightness, angle);
    this.vertex(back, -backWidth, backAlpha, brightness, angle);
  }

  vertex(point, width, opacity, brightness, angle) {
    const index = this.count++;
    this.positions.setXYZ(index, point.x + this.side.x * width, point.y + this.side.y * width, point.z + this.side.z * width);
    this.appearance.setXYZ(index, opacity, brightness, angle);
  }

  finish() {
    this.mesh.geometry.setDrawRange(0, this.count);
    if (!this.count) return;
    this.positions.addUpdateRange(0, this.count * 3);
    this.positions.needsUpdate = true;
    this.appearance.addUpdateRange(0, this.count * 3);
    this.appearance.needsUpdate = true;
  }
}
