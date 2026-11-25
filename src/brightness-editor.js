import { brightnessAt, DEFAULT_BRIGHTNESS } from './lifetime.js';

const WIDTH = 270;
const HEIGHT = 112;
const PLOT = { left: 34, top: 11, width: 226, height: 90 };
const xFor = age => PLOT.left + age * PLOT.width;
const yFor = value => PLOT.top + (1 - value / 2) * PLOT.height;

export function mountBrightnessEditor(container, onChange) {
  const chart = document.createElement('canvas');
  chart.width = WIDTH * 2;
  chart.height = HEIGHT * 2;
  chart.setAttribute('aria-label', 'Brightness curve. Drag a point or use the fields below.');
  chart.setAttribute('role', 'img');
  const context = chart.getContext('2d');
  context.scale(2, 2);

  const fields = document.createElement('div');
  fields.className = 'brightness-values';
  let curve = [...DEFAULT_BRIGHTNESS];
  const ageAt = index => index / (curve.length - 1);
  const inputs = curve.map((_, index) => {
    const age = `${ageAt(index) * 100}%`;
    const label = document.createElement('label');
    label.append(age);
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', min: 0, max: 200, step: 1 });
    input.setAttribute('aria-label', `Brightness at ${age} of lifetime, in percent`);
    input.addEventListener('input', () => {
      if (input.validity.valid && Number.isFinite(input.valueAsNumber)) update(index, input.valueAsNumber);
    });
    input.addEventListener('change', () => {
      input.value = Math.round(curve[index] * 100);
    });
    label.append(input);
    fields.append(label);
    return input;
  });

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset curve';
  reset.addEventListener('click', () => {
    setCurve(DEFAULT_BRIGHTNESS);
    onChange([...curve]);
  });
  container.append(chart, fields, reset);

  let drag = null;
  chart.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    const { x } = chartPoint(event);
    const index = Math.max(0, Math.min(curve.length - 1, Math.round((x - PLOT.left) / PLOT.width * (curve.length - 1))));
    drag = { pointer: event.pointerId, index };
    chart.setPointerCapture(event.pointerId);
    dragPoint(event);
  });
  chart.addEventListener('pointermove', event => {
    if (drag?.pointer === event.pointerId) dragPoint(event);
  });
  chart.addEventListener('lostpointercapture', event => {
    if (drag?.pointer === event.pointerId) drag = null;
  });

  function chartPoint(event) {
    const bounds = chart.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * WIDTH / bounds.width,
      y: (event.clientY - bounds.top) * HEIGHT / bounds.height };
  }

  function dragPoint(event) {
    const { y } = chartPoint(event);
    const value = Math.round((1 - (y - PLOT.top) / PLOT.height) * 200);
    update(drag.index, value);
    inputs[drag.index].value = Math.round(curve[drag.index] * 100);
  }

  function update(index, value) {
    curve[index] = Math.max(0, Math.min(200, value)) / 100;
    draw();
    onChange([...curve]);
  }

  function draw() {
    context.fillStyle = '#11131a';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.strokeStyle = '#3a4050';
    context.fillStyle = '#aaaebd';
    context.font = '11px system-ui';
    context.textBaseline = 'middle';
    context.lineWidth = 1;
    for (const level of [0, 1, 2]) {
      const y = yFor(level);
      context.beginPath();
      context.moveTo(PLOT.left, y);
      context.lineTo(xFor(1), y);
      context.stroke();
      context.fillText(`${level * 100}%`, 2, y);
    }
    for (let index = 0; index < curve.length; index++) {
      const x = xFor(ageAt(index));
      context.beginPath();
      context.moveTo(x, yFor(0));
      context.lineTo(x, yFor(2));
      context.stroke();
    }
    context.strokeStyle = '#f4c468';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(xFor(0), yFor(curve[0]));
    for (let sample = 1; sample <= 80; sample++) {
      const age = sample / 80;
      context.lineTo(xFor(age), yFor(brightnessAt(curve, age)));
    }
    context.stroke();
    context.fillStyle = '#f4c468';
    curve.forEach((value, index) => {
      context.beginPath();
      context.arc(xFor(ageAt(index)), yFor(value), 3.5, 0, 2 * Math.PI);
      context.fill();
    });
  }

  function setCurve(values = DEFAULT_BRIGHTNESS) {
    curve = [...values];
    inputs.forEach((input, index) => { input.value = Math.round(curve[index] * 100); });
    draw();
  }
  setCurve();
  return { setCurve };
}
