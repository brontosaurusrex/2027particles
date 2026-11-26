let handle;
let encoder;
let position = 0;
let ioError;
let queue = Promise.resolve();

function check(result) {
  if (ioError) throw ioError;
  if (result < 0) throw new Error(encoder.UTF8ToString(encoder._movie_error(result)));
}

async function processMessage(data) {
  try {
    if (data.type === 'open') {
      // Imported at runtime so the encoder is loaded only when a MOV is requested.
      const { default: createEncoder } = await import(/* @vite-ignore */ data.encoderURL);
      encoder = await createEncoder({
        writeOutput(pointer, length) {
          try {
            const written = handle.write(encoder.HEAPU8.subarray(pointer, pointer + length), { at: position });
            if (written !== length) throw new Error('Could not write the complete MOV. Check browser storage.');
            position += written;
            return written;
          } catch (error) {
            ioError = error;
            return -5;
          }
        },
        seekOutput(offset, flags) {
          try {
            if (flags & 0x10000) return handle.getSize();
            const whence = flags & 3;
            position = offset + (whence === 1 ? position : whence === 2 ? handle.getSize() : 0);
            return position;
          } catch (error) {
            ioError = error;
            return -5;
          }
        },
      });
      handle = await data.file.createSyncAccessHandle();
      check(encoder._movie_open(data.width, data.height, data.rate, Number(data.codec === 'cineform')));
    } else if (data.type === 'frame') {
      encoder.HEAPU8.set(new Uint8Array(data.pixels), encoder._movie_input());
      check(encoder._movie_push());
    } else if (data.type === 'finish') {
      check(encoder._movie_finish());
      handle.flush();
      handle.close();
      handle = null;
    } else if (data.type === 'abort') {
      handle?.close();
      handle = null;
    }
    self.postMessage({ id: data.id });
  } catch (error) {
    handle?.close();
    handle = null;
    self.postMessage({ id: data.id, error: error.message });
  }
}

self.onmessage = ({ data }) => {
  queue = queue.then(() => processMessage(data));
};
