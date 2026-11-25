import { BlobReader, ZipWriter } from '@zip.js/zip.js';
import { FPS, FRAME_COUNT, Simulation } from './simulation.js';
import { WIDTH, HEIGHT } from './renderer.js';

export const ARCHIVE_NAME = '2027particles.zip';

export function sequenceFrameCount(frameRate) {
  return FRAME_COUNT * frameRate / FPS;
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
  const frameCount = sequenceFrameCount(snapshot.frameRate);
  const stride = FPS / snapshot.frameRate;
  const sampleCount = snapshot.effects.depth > 0 ? 24 : 16;
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
      view.draw(simulation, 1 + (frame - 1) * stride, snapshot.camera, snapshot.effects, WIDTH, HEIGHT, {
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
