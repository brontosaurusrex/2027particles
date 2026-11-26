import { MAX_FILE_BYTES, decodeProject, encodeProject } from './project.js';

const PREFIX = '#project=';
const MAX_LINK_LENGTH = 8000;

export async function createShareLink(project, location) {
  const stream = new Blob([encodeProject(project)]).stream().pipeThrough(new CompressionStream('deflate'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (bytes.length > MAX_LINK_LENGTH) throw new Error('This project is too large for a share link. Use Save project.');
  const id = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const url = new URL(location);
  url.hash = PREFIX + id;
  if (url.href.length > MAX_LINK_LENGTH) throw new Error('This project is too large for a share link. Use Save project.');
  return url.href;
}

export async function readShareLink(hash) {
  if (!hash.startsWith(PREFIX)) return null;
  const id = hash.slice(PREFIX.length);
  if (!id || hash.length > MAX_LINK_LENGTH || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Invalid project share link.');
  }
  const bytes = Uint8Array.from(atob(id.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  let size = 0;
  const bounded = new TransformStream({
    transform(chunk, controller) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES) throw new Error('The shared project exceeds 4 MB.');
      controller.enqueue(chunk);
    },
  });
  return decodeProject(await new Response(stream.pipeThrough(bounded)).text());
}
