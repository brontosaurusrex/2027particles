import { emitterSettings } from './simulation.js';
import { DEFAULT_BRIGHTNESS } from './lifetime.js';

const STORAGE_KEY = '2027particles.emitter-presets.v1';
const SLOT_COUNT = 20;
const defaults = emitterSettings();

function readSlot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const key of Object.keys(defaults)) {
    if (key === 'brightness' || !Object.hasOwn(value, key)) continue;
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 400) return null;
  }
  if (Object.hasOwn(value, 'brightness')) {
    const curve = value.brightness;
    if (!Array.isArray(curve) || curve.length !== DEFAULT_BRIGHTNESS.length ||
        !curve.every(point => Number.isFinite(point) && point >= 0 && point <= 2)) return null;
  }
  return emitterSettings(value);
}

export function mountEmitterPresets(container, getEmitter, onLoad) {
  const select = container.querySelector('#preset-slot');
  const save = container.querySelector('#save-preset');
  const load = container.querySelector('#load-preset');
  const status = container.querySelector('#preset-status');
  const slotName = index => String(index + 1).padStart(2, '0');
  const slotKey = index => `${STORAGE_KEY}.${slotName(index)}`;
  const slots = Array.from({ length: SLOT_COUNT }, (_, index) => {
    try {
      return readSlot(JSON.parse(localStorage.getItem(slotKey(index))));
    } catch {
      showStatus('Some saved presets could not be read.');
      return null;
    }
  });

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function refresh(index) {
    select.replaceChildren(...slots.map((settings, slot) =>
      new Option(`${slotName(slot)} · ${settings ? 'Saved' : 'Empty'}`, slot, false, slot === index)));
    updateButtons();
  }

  function updateButtons() {
    const filled = Boolean(slots[select.selectedIndex]);
    save.textContent = filled ? 'Overwrite' : 'Save';
    load.disabled = !filled;
  }

  select.addEventListener('change', () => {
    updateButtons();
    showStatus('');
  });
  save.addEventListener('click', () => {
    const emitter = getEmitter();
    if (!emitter) return;
    const index = select.selectedIndex;
    const settings = emitterSettings(emitter);
    try {
      localStorage.setItem(slotKey(index), JSON.stringify(settings));
      slots[index] = settings;
      refresh(index);
      showStatus(`Saved slot ${slotName(index)}.`);
    } catch {
      showStatus('This browser could not save the preset.');
    }
  });
  load.addEventListener('click', () => {
    const index = select.selectedIndex;
    if (!getEmitter() || !slots[index]) return;
    onLoad(emitterSettings(slots[index]));
    showStatus(`Loaded slot ${slotName(index)}.`);
  });
  window.addEventListener('storage', event => {
    if (event.storageArea !== localStorage) return;
    if (event.key === null) {
      slots.fill(null);
      refresh(select.selectedIndex);
      return;
    }
    const index = slots.findIndex((_, slot) => slotKey(slot) === event.key);
    if (index === -1) return;
    try {
      slots[index] = readSlot(JSON.parse(event.newValue));
    } catch {
      slots[index] = null;
    }
    refresh(select.selectedIndex);
  });

  refresh(0);
}
