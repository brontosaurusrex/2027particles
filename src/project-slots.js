import { decodeProject, encodeProject } from './project.js';
import { emitterSettings } from './simulation.js';

const SLOT_COUNT = 20;
const DATABASE_NAME = '2027particles';
const LEGACY_KEY = '2027particles.emitter-presets.v1';

function connect() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects');
      request.result.createObjectStore('names', { keyPath: 'index' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('This browser could not open project storage.'));
    request.onblocked = () => reject(new Error('Close other tabs of this editor to open project storage.'));
  });
}

function transaction(database, stores, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, mode);
    const result = operation(tx);
    tx.oncomplete = () => resolve(result?.result);
    tx.onabort = () => reject(new Error('This browser could not complete the project storage operation.'));
  });
}

export function mountProjectSlots(dialog, open, captureProject, restoreProject, starterProject) {
  const select = dialog.querySelector('#project-slot');
  const name = dialog.querySelector('#project-slot-name');
  const rename = dialog.querySelector('#rename-slot');
  const load = dialog.querySelector('#load-slot');
  const save = dialog.querySelector('#save-slot');
  const status = dialog.querySelector('#slot-status');
  const slotNumber = index => String(index + 1).padStart(2, '0');
  const slotIndex = () => Number(select.value);
  const slotNames = new Map();
  const legacy = Array.from({ length: SLOT_COUNT }, (_, index) => {
    try {
      const value = JSON.parse(localStorage.getItem(`${LEGACY_KEY}.${slotNumber(index)}`));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const draft = structuredClone(starterProject);
      Object.assign(draft.emitters[0], emitterSettings(value));
      return decodeProject(encodeProject(draft));
    } catch {
      return null;
    }
  });
  let database;
  let busy = false;

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function updateButtons() {
    const index = slotIndex();
    const savedName = slotNames.get(index);
    select.disabled = name.disabled = save.disabled = busy;
    load.disabled = busy || (!savedName && !legacy[index]);
    rename.disabled = busy || !savedName || !name.value.trim() || name.value.trim() === savedName;
    save.textContent = savedName || legacy[index] ? 'Overwrite' : 'Save';
  }

  function selectSlot() {
    name.value = slotNames.get(slotIndex()) ?? '';
    updateButtons();
  }

  function refresh(index) {
    select.replaceChildren(...Array.from({ length: SLOT_COUNT }, (_, slot) =>
      new Option(`${slotNumber(slot)} · ${slotNames.get(slot) ?? (legacy[slot] ? 'Old emitter preset' : 'Empty')}`,
        slot, false, slot === index)));
    selectSlot();
  }

  async function run(operation) {
    if (busy) return;
    busy = true;
    showStatus('');
    updateButtons();
    try {
      database ??= await connect();
      await operation(database);
    } catch (error) {
      showStatus(error.message);
    } finally {
      busy = false;
      updateButtons();
    }
  }

  open.addEventListener('click', () => {
    dialog.showModal();
    run(async db => {
      const names = await transaction(db, 'names', 'readonly', tx => tx.objectStore('names').getAll());
      slotNames.clear();
      names.forEach(({ index, name }) => slotNames.set(index, name));
      refresh(slotIndex());
    });
  });
  dialog.querySelector('#close-slots').addEventListener('click', () => dialog.close());
  select.addEventListener('change', () => {
    showStatus('');
    selectSlot();
  });
  name.addEventListener('input', updateButtons);

  save.addEventListener('click', () => {
    const index = slotIndex();
    const slotName = name.value.trim() || `Project ${slotNumber(index)}`;
    const json = encodeProject(captureProject());
    run(async db => {
      await transaction(db, ['projects', 'names'], 'readwrite', tx => {
        tx.objectStore('projects').put(json, index);
        tx.objectStore('names').put({ index, name: slotName });
      });
      slotNames.set(index, slotName);
      refresh(index);
      showStatus('Project saved.');
    });
  });

  rename.addEventListener('click', () => {
    const index = slotIndex();
    const slotName = name.value.trim();
    if (!slotNames.has(index) || !slotName) return;
    run(async db => {
      await transaction(db, 'names', 'readwrite', tx => tx.objectStore('names').put({ index, name: slotName }));
      slotNames.set(index, slotName);
      refresh(index);
      showStatus('Slot renamed.');
    });
  });

  load.addEventListener('click', () => {
    const index = slotIndex();
    run(async db => {
      const saved = await transaction(db, 'projects', 'readonly', tx => tx.objectStore('projects').get(index));
      if (!dialog.open) return;
      if (!saved && !legacy[index]) throw new Error('This slot is empty.');
      restoreProject(saved ? decodeProject(saved) : structuredClone(legacy[index]));
      dialog.close();
    });
  });

  refresh(0);
}
