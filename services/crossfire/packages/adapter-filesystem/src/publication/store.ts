import { constants, lstatSync, realpathSync } from 'node:fs';
import { open, rename, unlink, opendir, rmdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { PublicationFile } from '@ctlflow/crossfire-domain/publication/values';
import { PUBLICATION_LIMITS } from '@ctlflow/crossfire-domain/publication/values';
import type { PublicationStore } from '@ctlflow/crossfire-domain/publication/port';
import { privateDir } from '../index.js';
import { acquireFileLock } from '../lock.js';

function absent(error: unknown): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'; }
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
export function createPublicationStore(directory: string, maximumUploads: number): PublicationStore {
  if (!Number.isSafeInteger(maximumUploads) || maximumUploads < 1 || maximumUploads > 32) throw new Error('Invalid bounded report upload capacity');
  const root = privateDir(resolve(directory)), unlock = acquireFileLock(join(root, 'owner'));
  const busy = new Set<string>(); let uploads = 0;
  function location(id: string): string {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(id)) throw new Error('Invalid report storage identity');
    if (realpathSync(root) !== root) throw new Error('Report storage cannot traverse symlinks');
    return join(root, id);
  }
  function existing(id: string): string {
    const path = location(id), info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid!() || info.mode & 0o077 || realpathSync(path) !== path)
      throw new Error('Report storage must be private and owned');
    return path;
  }
  async function entries(path: string): Promise<string[]> {
    const names: string[] = [];
    for await (const entry of await opendir(path)) {
      if (names.length >= PUBLICATION_LIMITS.files + 1) throw new Error('Report storage contains unexpected files');
      names.push(entry.name);
    }
    return names;
  }
  async function discardPending(path: string): Promise<void> {
    const pending = await entries(path);
    for (const entry of pending) if (/^\.pending-[a-f0-9-]{36}$/u.test(entry)) await unlink(join(path, entry));
  }
  async function read(id: string, file: PublicationFile) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      location(file.id);
      handle = await open(join(existing(id), file.id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      if (!info.isFile() || info.uid !== process.getuid!() || info.mode & 0o077 || info.nlink !== 1 || info.size !== file.bytes)
        throw new Error('Report bytes do not match the private regular file');
      const descriptor = handle; let closed = false;
      const close = async () => { if (!closed) { closed = true; await descriptor.close(); } };
      const chunks: AsyncIterable<Uint8Array> = { async *[Symbol.asyncIterator]() {
        try {
          let offset = 0;
          while (offset < file.bytes) {
            const bytes = new Uint8Array(Math.min(65536, file.bytes - offset));
            const result = await descriptor.read(bytes, 0, bytes.length, offset);
            if (result.bytesRead === 0) throw new Error('Report changed during read');
            offset += result.bytesRead; yield bytes.subarray(0, result.bytesRead);
          }
          if ((await descriptor.stat()).size !== file.bytes) throw new Error('Report changed during read');
        } finally { await close(); }
      } };
      return success({ chunks, close });
    } catch {
      await handle?.close().catch(() => undefined); return failure('unavailable', 'Report file is unavailable or failed its storage integrity check');
    }
  }
  return {
    async exclusive<T>(id: string, operation: () => Promise<Result<T>>): Promise<Result<T>> {
      if (busy.has(id)) return failure('conflict', 'Another report operation is in progress; retry this exact operation');
      busy.add(id);
      try { return await operation(); } finally { busy.delete(id); }
    },
    async upload(id, file, input, signal) {
      if (uploads >= maximumUploads) return failure('rate_limit', 'Report upload capacity is busy; retry this exact file');
      uploads++;
      let temporary: string | undefined, handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const path = privateDir(location(id));
        location(file.id);
        await discardPending(path);
        temporary = join(path, '.pending-' + randomUUID());
        handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        const digest = createHash('sha256'); let size = 0;
        for await (const chunk of input.chunks) {
          signal.throwIfAborted();
          if (!(chunk instanceof Uint8Array)) return failure('invalid', 'A binary upload yielded non-byte content');
          size += chunk.byteLength;
          if (size > file.bytes) return failure('body_too_large', 'Report upload exceeds its declared size');
          digest.update(chunk); let offset = 0;
          while (offset < chunk.byteLength) {
            const written = await handle.write(chunk, offset, chunk.byteLength - offset);
            if (!written.bytesWritten) throw new Error('Report write made no progress');
            offset += written.bytesWritten;
          }
        }
        signal.throwIfAborted();
        if (size !== file.bytes || digest.digest('hex') !== file.sha256) return failure('invalid', 'Report upload size or digest mismatch');
        await handle.sync(); await handle.close(); handle = undefined;
        await rename(temporary, join(path, file.id)); temporary = undefined;
        await syncDirectory(path);
        return success(undefined);
      } catch { return failure('unavailable', 'Report upload failed; no partial file was published'); }
      finally { await handle?.close().catch(() => undefined); if (temporary) await unlink(temporary).catch(() => undefined); uploads--; }
    },
    async verify(id, files) {
      try { await discardPending(existing(id)); } catch { return failure('unavailable', 'Report staging cleanup failed before verification'); }
      for (const file of files) {
        const stream = await read(id, file); if (!stream.ok) return stream;
        try {
          const digest = createHash('sha256'); for await (const chunk of stream.value.chunks) digest.update(chunk);
          if (digest.digest('hex') !== file.sha256) return failure('conflict', 'Report bytes no longer match the declared manifest');
        } catch { return failure('unavailable', 'Report verification failed'); } finally { await stream.value.close(); }
      }
      try { await syncDirectory(existing(id)); await syncDirectory(root); await syncDirectory(dirname(root)); }
      catch { return failure('unavailable', 'Report directory persistence failed before publication'); }
      return success(undefined);
    },
    read,
    async remove(id) {
      let path: string;
      try { path = existing(id); }
      catch (error) {
        if (!absent(error)) return failure('unavailable', 'Report storage cleanup remains pending');
        try { await syncDirectory(root); return success(undefined); }
        catch { return failure('unavailable', 'Report storage cleanup remains pending'); }
      }
      try {
        const files = await entries(path);
        for (const file of files) {
          if (!/^(?:[a-f0-9-]{36}|\.pending-[a-f0-9-]{36})$/u.test(file)) return failure('unavailable', 'Report storage contains an unexpected entry');
          const information = lstatSync(join(path, file));
          if (information.isDirectory()) return failure('unavailable', 'Report storage contains an unexpected directory');
          await unlink(join(path, file));
        }
        await rmdir(path); await syncDirectory(root); return success(undefined);
      } catch { return failure('unavailable', 'Report storage cleanup remains pending'); }
    },
    close: unlock,
  };
}
