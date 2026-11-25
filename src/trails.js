import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial, Vector3,
} from 'three/webgpu';
import { attribute, uniform } from 'three/tsl';
import { CAPACITY, TRAIL_HISTORY } from './simulation.js';

export class MotionTrails {
  constructor() {
    const capacity = CAPACITY * TRAIL_HISTORY * 6;
    this.positions = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.opacities = new BufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('trailOpacity', this.opacities);
    const material = new MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true,
    });
    material.opacityNode = attribute('trailOpacity', 'float');
    material.colorNode = uniform(new Color(0xffb62e).multiplyScalar(2.1));
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.view = new Vector3();
    this.front = new Vector3();
    this.back = new Vector3();
    this.side = new Vector3();
    this.count = 0;
  }

  begin(camera, duration) {
    this.duration = duration;
    this.mesh.visible = duration > 0;
    this.count = 0;
    if (this.mesh.visible) camera.getWorldDirection(this.view);
  }

  add(particle, head, time, scale) {
    const { history, historyNext, historyCount, size } = particle;
    if (!this.mesh.visible || !historyCount) return;
    const cutoff = time - this.duration;
    this.front.copy(head);
    let frontTime = time;
    const width = size * scale * 0.34;
    for (let index = 0; index < historyCount; index++) {
      const slot = (historyNext - 1 - index + TRAIL_HISTORY) % TRAIL_HISTORY * 4;
      const sampleTime = history[slot + 3];
      if (sampleTime >= frontTime) continue;
      this.back.fromArray(history, slot);
      const backTime = Math.max(cutoff, sampleTime);
      if (sampleTime < cutoff) this.back.lerp(this.front, (cutoff - sampleTime) / (frontTime - sampleTime));
      const frontFade = (frontTime - cutoff) / this.duration;
      const backFade = (backTime - cutoff) / this.duration;
      this.segment(width, frontFade, backFade);
      if (backTime === cutoff) break;
      this.front.copy(this.back);
      frontTime = backTime;
    }
  }

  segment(width, frontFade, backFade) {
    const { view, front, back, side } = this;
    side.subVectors(front, back).cross(view);
    if (side.lengthSq() < 0.0000001) return;
    side.normalize();
    const frontWidth = width * frontFade;
    const backWidth = width * backFade;
    const frontAlpha = frontFade ** 1.8 * 0.68;
    const backAlpha = backFade ** 1.8 * 0.68;
    this.vertex(front, frontWidth, frontAlpha);
    this.vertex(front, -frontWidth, frontAlpha);
    this.vertex(back, backWidth, backAlpha);
    this.vertex(back, backWidth, backAlpha);
    this.vertex(front, -frontWidth, frontAlpha);
    this.vertex(back, -backWidth, backAlpha);
  }

  vertex(point, width, opacity) {
    const index = this.count++;
    this.positions.setXYZ(index, point.x + this.side.x * width, point.y + this.side.y * width, point.z + this.side.z * width);
    this.opacities.setX(index, opacity);
  }

  finish() {
    this.mesh.geometry.setDrawRange(0, this.count);
    if (!this.count) return;
    this.positions.addUpdateRange(0, this.count * 3);
    this.positions.needsUpdate = true;
    this.opacities.addUpdateRange(0, this.count);
    this.opacities.needsUpdate = true;
  }
}
