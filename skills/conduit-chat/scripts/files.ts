import { createReadStream, statSync, openSync, closeSync, writeSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';

export function uploadStream(path: string, maximum: number): Readable {
  const expected = statSync(path);
  if (!expected.isFile() || expected.size > maximum) throw new Error('Upload is not a regular file within the instance size limit');
  let bytes = 0;
  const source = createReadStream(path);
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > expected.size ? new Error('Upload file changed or exceeded its limit') : undefined, chunk);
    },
    flush(callback) { callback(bytes !== expected.size ? new Error('Upload file changed while being read') : undefined); },
  });
  source.on('error', error => guard.destroy(error));
  guard.on('close', () => source.destroy());
  return source.pipe(guard);
}

export async function saveStream(source: AsyncIterable<Buffer>, path: string, maximum: number) {
  const descriptor = openSync(path, 'wx', 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of source) {
      bytes += chunk.length;
      if (bytes > maximum) throw new Error('File exceeds the instance limit');
      let offset = 0;
      while (offset < chunk.length) offset += writeSync(descriptor, chunk, offset);
      hash.update(chunk);
    }
  } catch (error) { unlinkSync(path); throw error; }
  finally { closeSync(descriptor); }
  return { path: resolve(path), bytes, sha256: hash.digest('hex') };
}
