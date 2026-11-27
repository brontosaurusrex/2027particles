import { BlobReader, ZipWriter } from '@zip.js/zip.js';
import { Simulation, simulationFrameAtRate } from './simulation.js';
import { WIDTH, HEIGHT } from './renderer.js';

export const ARCHIVE_NAME = '2027particles.zip';
export const FULL_DOF_SAMPLES = 24;
const PRINT_WIDTH = WIDTH * 2;
const PRINT_HEIGHT = HEIGHT * 2;
const PRINT_PPI = 300;

function exportSamples(snapshot) {
  return (snapshot.effects.depth > 0 || snapshot.effects.noise?.depth?.amount) ? (snapshot.dofSamples ?? FULL_DOF_SAMPLES) : 16;
}

export async function renderPrintFrame(view, snapshot, signal, onProgress) {
  const simulation = new Simulation(snapshot.forces, snapshot.emitters, view.particleShapes, snapshot.visibleEmitterIds, snapshot.noiseSources);
  const camera = snapshot.camera.clone();
  const canvas = new OffscreenCanvas(PRINT_WIDTH, PRINT_HEIGHT);
  const context = canvas.getContext('2d');
  // SSR needs the whole frame so a reflection can cross a tile boundary.
  const fullFrame = snapshot.effects.ssr && view.supportsSSR;
  const width = fullFrame ? PRINT_WIDTH : WIDTH;
  const height = fullFrame ? PRINT_HEIGHT : HEIGHT;
  const tileCount = PRINT_WIDTH * PRINT_HEIGHT / (width * height);
  const sampleCount = exportSamples(snapshot);
  let completed = 0;
  for (let y = 0; y < PRINT_HEIGHT; y += height) {
    for (let x = 0; x < PRINT_WIDTH; x += width) {
      signal.throwIfAborted();
      camera.setViewOffset(PRINT_WIDTH, PRINT_HEIGHT, x, y, width, height);
      view.draw(simulation, snapshot.frame, camera, snapshot.effects, width, height, {
        exporting: true, sampleCount, black: snapshot.black, frameRate: snapshot.frameRate, target: snapshot.target,
      });
      const tile = await view.readImage();
      signal.throwIfAborted();
      context.putImageData(tile, x, y);
      onProgress(++completed, tileCount);
    }
  }
  const png = await canvas.convertToBlob({ type: 'image/png' });
  signal.throwIfAborted();
  return pngWithMetadata(png, PRINT_PPI);
}

function pngChunk(type, data) {
  const bytes = new Uint8Array(12 + data.length);
  const chunk = new DataView(bytes.buffer);
  chunk.setUint32(0, data.length);
  chunk.setUint32(4, type);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, 8 + data.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}

const SRGB = 0x73524742;
const PHYS = 0x70485973;
const colorChunks = new Set([SRGB, 0x69434350, 0x67414d41, 0x6348524d, 0x63494350]);
const srgbChunk = pngChunk(SRGB, Uint8Array.of(0));

async function pngWithMetadata(png, ppi) {
  // The encoder receives sRGB canvas pixels. Use one unambiguous color declaration.
  const parts = [png.slice(0, 8)];
  for (let offset = 8; offset + 8 <= png.size;) {
    const header = new DataView(await png.slice(offset, offset + 8).arrayBuffer());
    const next = offset + header.getUint32(0) + 12;
    const type = header.getUint32(4);
    if (type === 0x49444154) {
      if (ppi) {
        const data = new DataView(new ArrayBuffer(9));
        const ppm = Math.round(ppi / 0.0254);
        data.setUint32(0, ppm);
        data.setUint32(4, ppm);
        data.setUint8(8, 1);
        parts.push(pngChunk(PHYS, new Uint8Array(data.buffer)));
      }
      return new Blob([...parts, png.slice(offset)], { type: 'image/png' });
    }
    if (!colorChunks.has(type) && (type !== PHYS || !ppi)) parts.push(png.slice(offset, next));
    if (type === 0x49484452) parts.push(srgbChunk);
    offset = next;
  }
  throw new Error('Could not tag the exported PNG.');
}

export async function temporaryExport(extension) {
  const directory = await navigator.storage.getDirectory();
  const temporaryName = `particles-${crypto.randomUUID()}.${extension}`;
  const handle = await directory.getFileHandle(temporaryName, { create: true });
  return { handle, directory, temporaryName };
}

export async function chooseDestination(filename = ARCHIVE_NAME) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
      });
      return { handle };
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (error.name !== 'SecurityError' && error.name !== 'NotSupportedError') throw error;
    }
  }
  return temporaryExport('zip');
}

export async function discardDestination(destination) {
  if (destination?.directory) await destination.directory.removeEntry(destination.temporaryName);
}

export async function renderFrames(view, snapshot, signal, receive, onProgress) {
  const simulation = new Simulation(snapshot.forces, snapshot.emitters, view.particleShapes, snapshot.visibleEmitterIds, snapshot.noiseSources);
  const { frameCount, frameRate } = snapshot;
  const sampleCount = exportSamples(snapshot);
  for (let frame = 1; frame <= frameCount; frame++) {
    signal.throwIfAborted();
    view.draw(simulation, simulationFrameAtRate(frame, frameRate), snapshot.camera, snapshot.effects, WIDTH, HEIGHT, {
      exporting: true, sampleCount, frameRate, target: snapshot.target, backdrop: snapshot.winter ? 'winter' : undefined,
      black: snapshot.black,
    });
    const image = await view.readImage();
    signal.throwIfAborted();
    await receive(image, frame);
    onProgress(frame);
  }
  signal.throwIfAborted();
}

export async function renderArchive(view, snapshot, destination, signal, onProgress) {
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
    await renderFrames(view, snapshot, signal, async (image, frame) => {
      context.putImageData(image, 0, 0);
      const blob = await pngWithMetadata(await png.convertToBlob({ type: 'image/png' }));
      signal.throwIfAborted();
      await zip.add(`frame_${String(frame).padStart(4, '0')}.png`, new BlobReader(blob), {
        level: 0, useWebWorkers: false, signal,
      });
    }, onProgress);
    await zip.close();
    return destination.directory ? await destination.handle.getFile() : null;
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  } finally {
    writer.releaseLock();
  }
}
