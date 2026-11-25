export const DEFAULT_BRIGHTNESS = Object.freeze([1, 1, 1, 1, 1]);

export function brightnessAt(curve, age) {
  const sample = Math.max(0, Math.min(1, age)) * (curve.length - 1);
  const start = Math.min(curve.length - 2, Math.floor(sample));
  const offset = sample - start;
  const blend = offset * offset * (3 - 2 * offset);
  return curve[start] + (curve[start + 1] - curve[start]) * blend;
}
