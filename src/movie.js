import { renderFrames } from './export.js';
import { WIDTH, HEIGHT } from './renderer.js';

export async function renderMovie(view, snapshot, destination, codec, signal, onProgress) {
  const worker = new Worker(new URL('./movie-worker.js', import.meta.url), { type: 'module' });
  let nextId = 0;
  function request(message, transfer = [], requestSignal = signal) {
    requestSignal.throwIfAborted();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const aborted = () => complete(requestSignal.reason);
      function complete(error) {
        requestSignal.removeEventListener('abort', aborted);
        worker.onmessage = worker.onerror = null;
        if (error) reject(error);
        else resolve();
      }
      requestSignal.addEventListener('abort', aborted, { once: true });
      worker.onmessage = ({ data }) => {
        if (data.id === id) complete(data.error ? new Error(data.error) : null);
      };
      worker.onerror = event => complete(new Error(event.message || 'Could not run the MOV encoder.'));
      try {
        worker.postMessage({ ...message, id }, transfer);
      } catch (error) {
        complete(error);
      }
    });
  }
  try {
    const encoderURL = new URL(`${import.meta.env.BASE_URL}video/encoder.js`, location.href).href;
    await request({
      type: 'open', encoderURL, file: destination.handle, codec, width: WIDTH, height: HEIGHT, rate: snapshot.frameRate,
    });
    await renderFrames(view, { ...snapshot, black: true }, signal, async image => {
      const pixels = image.data.buffer;
      await request({ type: 'frame', pixels }, [pixels]);
    }, onProgress);
    await request({ type: 'finish' });
    const file = await destination.handle.getFile();
    signal.throwIfAborted();
    return file;
  } finally {
    if (signal.aborted) {
      // Close the worker's file handle before the caller removes the partial output.
      await request({ type: 'abort' }, [], AbortSignal.timeout(3000)).catch(() => {});
    }
    worker.terminate();
  }
}
