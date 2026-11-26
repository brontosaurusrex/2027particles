import { BlobReader, ZipWriter } from '@zip.js/zip.js';
import { Simulation, simulationFrameAtRate } from './simulation.js';
import { WIDTH, HEIGHT } from './renderer.js';

export const ARCHIVE_NAME = '2027particles.zip';
export const FULL_DOF_SAMPLES = 24;
const PRINT_WIDTH = WIDTH * 2;
const PRINT_HEIGHT = HEIGHT * 2;
const PRINT_PPI = 300;

function exportSamples(snapshot) {
  return snapshot.effects.depth > 0 ? (snapshot.dofSamples ?? FULL_DOF_SAMPLES) : 16;
}

export async function renderPrintFrame(view, snapshot, signal, onProgress) {
  const simulation = new Simulation(snapshot.forces, snapshot.emitters, view.shapeChoices);
  const camera = snapshot.camera.clone();
  const canvas = new OffscreenCanvas(PRINT_WIDTH, PRINT_HEIGHT);
  const context = canvas.getContext('2d');
  const tileCount = PRINT_WIDTH * PRINT_HEIGHT / (WIDTH * HEIGHT);
  const sampleCount = exportSamples(snapshot);
  let completed = 0;
  for (let y = 0; y < PRINT_HEIGHT; y += HEIGHT) {
    for (let x = 0; x < PRINT_WIDTH; x += WIDTH) {
      signal.throwIfAborted();
      camera.setViewOffset(PRINT_WIDTH, PRINT_HEIGHT, x, y, WIDTH, HEIGHT);
      view.draw(simulation, snapshot.frame, camera, snapshot.effects, WIDTH, HEIGHT, {
        exporting: true, sampleCount, winter: false,
      });
      const tile = await view.readImage();
      signal.throwIfAborted();
      context.putImageData(tile, x, y);
      onProgress(++completed, tileCount);
    }
  }
  const png = await canvas.convertToBlob({ type: 'image/png' });
  signal.throwIfAborted();
  return setPrintResolution(png);
}

// PNG stores physical resolution as pixels per metre in a pHYs chunk before image data.
async function setPrintResolution(png) {
  const physical = 0x70485973; // pHYs
  const imageData = 0x49444154; // IDAT
  const pixelsPerMetre = Math.round(PRINT_PPI / 0.0254);
  const bytes = new Uint8Array(21);
  const chunk = new DataView(bytes.buffer);
  chunk.setUint32(0, 9);
  chunk.setUint32(4, physical);
  chunk.setUint32(8, pixelsPerMetre);
  chunk.setUint32(12, pixelsPerMetre);
  bytes[16] = 1;
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, 17)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  for (let offset = 8; offset + 8 <= png.size;) {
    const header = new DataView(await png.slice(offset, offset + 8).arrayBuffer());
    const next = offset + header.getUint32(0) + 12;
    const type = header.getUint32(4);
    if (type === physical || type === imageData) {
      const end = type === physical ? next : offset;
      return new Blob([png.slice(0, offset), bytes, png.slice(end)], { type: 'image/png' });
    }
    offset = next;
  }
  throw new Error('Could not set the print resolution.');
}

export async function chooseDestination() {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: ARCHIVE_NAME,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
      });
      return { handle };
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (error.name !== 'SecurityError' && error.name !== 'NotSupportedError') throw error;
    }
  }
  const directory = await navigator.storage.getDirectory();
  const temporaryName = `particles-${crypto.randomUUID()}.zip`;
  const handle = await directory.getFileHandle(temporaryName, { create: true });
  return { handle, directory, temporaryName };
}

export async function discardDestination(destination) {
  if (destination?.directory) await destination.directory.removeEntry(destination.temporaryName);
}

export async function renderArchive(view, snapshot, destination, signal, onProgress) {
  const simulation = new Simulation(snapshot.forces, snapshot.emitters, view.shapeChoices);
  const { frameCount, frameRate } = snapshot;
  const sampleCount = exportSamples(snapshot);
  const png = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = png.getContext('2d');
  const writer = (await destination.handle.createWritable()).getWriter();
  const stream = new WritableStream({
    write: chunk => writer.write(chunk),
    close: () => writer.close(),
    abort: reason => writer.abort(reason),
  });
  const zip = new ZipWriter(stream);

  try {
    for (let frame = 1; frame <= frameCount; frame++) {
      signal.throwIfAborted();
      view.draw(simulation, simulationFrameAtRate(frame, frameRate), snapshot.camera, snapshot.effects, WIDTH, HEIGHT, {
        exporting: true, sampleCount, winter: snapshot.winter,
      });
      const image = await view.readImage();
      signal.throwIfAborted();
      context.putImageData(image, 0, 0);
      const blob = await png.convertToBlob({ type: 'image/png' });
      signal.throwIfAborted();
      await zip.add(`frame_${String(frame).padStart(4, '0')}.png`, new BlobReader(blob), {
        level: 0, useWebWorkers: false, signal,
      });
      onProgress(frame);
    }
    signal.throwIfAborted();
    await zip.close();
    return destination.directory ? await destination.handle.getFile() : null;
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  } finally {
    writer.releaseLock();
  }
}
