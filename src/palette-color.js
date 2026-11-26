import { attribute, hue, vec3 } from 'three/tsl';
import { PALETTES } from './simulation.js';

const luma = [0.2126, 0.7152, 0.0722];
const gain = 1.45;

export function particleTint(particle) {
  return (PALETTES[particle.style?.palette] ?? PALETTES.original).tint;
}

export function colorWithPalette(rgb, angle) {
  const tint = attribute('paletteTint', 'vec3');
  const tinted = rgb.dot(vec3(...luma)).mul(gain).mul(tint);
  return hue(tint.dot(tint).greaterThan(0).select(tinted, rgb), angle);
}

export function tintVectorColor(color, tint, index) {
  const r = tint.getX(index);
  const g = tint.getY(index);
  const b = tint.getZ(index);
  if (r || g || b) {
    const amount = (color.r * luma[0] + color.g * luma[1] + color.b * luma[2]) * gain;
    color.setRGB(r * amount, g * amount, b * amount);
  }
  return color;
}
