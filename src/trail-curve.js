import { CatmullRomCurve3, Matrix4, Vector3 } from 'three/webgpu';
import { TRAIL_HISTORY } from './simulation.js';

const ANCHOR_LIMIT = 25;
export const TRAIL_SEGMENT_LIMIT = 48;
const SCREEN_TOLERANCE = 0.65;
const SCREEN_PROBES = [1 / 3, 2 / 3];
const MIN_DISTANCE_SQUARED = 1e-10;

function historySlot(next, index) {
  return ((next - 1 - index + TRAIL_HISTORY) % TRAIL_HISTORY) * 4;
}

function lastSample(history, next, count, cutoff) {
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (history[historySlot(next, middle) + 3] > cutoff) low = middle + 1;
    else high = middle;
  }
  return low;
}

function reversal(a, b) {
  return a.dot(b) < -0.55 * Math.sqrt(a.lengthSq() * b.lengthSq());
}

export class TrailCurve {
  constructor() {
    this.anchors = Array.from({ length: ANCHOR_LIMIT }, () => new Vector3());
    this.anchorFades = new Float64Array(ANCHOR_LIMIT);
    this.spline = new CatmullRomCurve3();
    this.samples = Array.from({ length: TRAIL_SEGMENT_LIMIT + 1 }, () => new Vector3());
    this.fades = new Float64Array(TRAIL_SEGMENT_LIMIT + 1);
    this.subdivisions = new Uint8Array(ANCHOR_LIMIT - 1);
    this.linear = new Uint8Array(ANCHOR_LIMIT - 1);
    this.projection = new Matrix4();
    this.chord = new Vector3();
    this.scratch = new Vector3();
    this.projectedStart = new Vector3();
    this.projectedEnd = new Vector3();
    this.projectedSample = new Vector3();
  }

  setCamera(camera, width, height) {
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.width = width;
    this.height = height;
  }

  collect(particle, head, time, duration) {
    const { history, historyNext, historyCount } = particle;
    const cutoff = time - duration;
    const last = lastSample(history, historyNext, historyCount, cutoff);
    const stride = Math.max(1, Math.ceil(last / (ANCHOR_LIMIT - 2)));
    this.anchors[0].copy(head);
    this.anchorFades[0] = 1;
    let count = 1;
    for (let index = 0; ; index = Math.min(last, index + stride)) {
      const slot = historySlot(historyNext, index);
      const sampleTime = history[slot + 3];
      if (sampleTime < time) {
        const anchor = this.anchors[count].fromArray(history, slot);
        if (sampleTime < cutoff) {
          const nextSlot = historySlot(historyNext, index - 1);
          const nextTime = index > 0 ? history[nextSlot + 3] : time;
          const nextPoint = index > 0 ? this.scratch.fromArray(history, nextSlot) : head;
          anchor.lerp(nextPoint, (cutoff - sampleTime) / (nextTime - sampleTime));
        }
        const fade = Math.max(0, (sampleTime - cutoff) / duration);
        if (anchor.distanceToSquared(this.anchors[count - 1]) > MIN_DISTANCE_SQUARED) {
          this.anchorFades[count++] = fade;
        } else if (index === last && count > 1) {
          this.anchorFades[count - 1] = fade;
        }
      }
      if (index === last) break;
    }
    return count - 1;
  }

  sample(segment, fraction, target) {
    if (this.linear[segment]) {
      return target.lerpVectors(this.anchors[segment], this.anchors[segment + 1], fraction);
    }
    return this.spline.getPoint((segment + fraction) / this.segmentCount, target);
  }

  screenError(segment) {
    const a = this.projectedStart.copy(this.anchors[segment]).applyMatrix4(this.projection);
    const b = this.projectedEnd.copy(this.anchors[segment + 1]).applyMatrix4(this.projection);
    const dx = (b.x - a.x) * this.width / 2;
    const dy = (b.y - a.y) * this.height / 2;
    const lengthSquared = dx * dx + dy * dy;
    let error = 0;
    // Two interior probes also catch S-bends whose midpoint lies on the chord.
    for (const fraction of SCREEN_PROBES) {
      const probe = this.sample(segment, fraction, this.projectedSample).applyMatrix4(this.projection);
      const x = (probe.x - a.x) * this.width / 2;
      const y = (probe.y - a.y) * this.height / 2;
      const along = lengthSquared ? Math.max(0, Math.min(1, (x * dx + y * dy) / lengthSquared)) : 0;
      error = Math.max(error, Math.hypot(x - dx * along, y - dy * along));
    }
    return Number.isFinite(error) ? error : 0;
  }

  tessellate(particle, head, time, duration) {
    const spans = this.collect(particle, head, time, duration);
    if (!spans) return 0;
    this.segmentCount = spans;
    this.spline.points.length = spans + 1;
    for (let i = 0; i <= spans; i++) this.spline.points[i] = this.anchors[i];

    let requested = 0;
    for (let i = 0; i < spans; i++) {
      const chord = this.chord.subVectors(this.anchors[i + 1], this.anchors[i]);
      this.linear[i] = Number(spans === 1 ||
        (i > 0 && reversal(chord, this.scratch.subVectors(this.anchors[i], this.anchors[i - 1]))) ||
        (i + 1 < spans && reversal(chord, this.scratch.subVectors(this.anchors[i + 2], this.anchors[i + 1]))));
      const error = this.linear[i] ? 0 : this.screenError(i);
      const divisions = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(error / SCREEN_TOLERANCE))));
      this.subdivisions[i] = divisions;
      requested += divisions - 1;
    }
    const available = Math.min(requested, TRAIL_SEGMENT_LIMIT - spans);
    this.samples[0].copy(head);
    this.fades[0] = 1;
    let count = 0;
    let demand = 0;
    let allocated = 0;
    for (let i = 0; i < spans; i++) {
      demand += this.subdivisions[i] - 1;
      const share = requested ? Math.floor(demand * available / requested) : 0;
      const divisions = 1 + share - allocated;
      allocated = share;
      for (let step = 1; step <= divisions; step++) {
        const fraction = step / divisions;
        const point = this.samples[++count];
        if (step === divisions) point.copy(this.anchors[i + 1]);
        else this.sample(i, fraction, point);
        this.fades[count] = this.anchorFades[i] + (this.anchorFades[i + 1] - this.anchorFades[i]) * fraction;
      }
    }
    return count;
  }
}
