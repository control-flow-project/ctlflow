import { decodeUtf8 } from '@ctlflow/crossfire-kernel/bytes';
import { json } from '@ctlflow/crossfire-contracts/matrix';
import { openSync, closeSync, fstatSync, constants, readSync, realpathSync, type Stats } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';

export function ownedFile<Value>(path: string, maximum: number, operation: (descriptor: number, information: Stats) => Value): Value {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || realpathSync(dirname(path)) !== resolve(dirname(path))) {
    throw new Error('Native evidence requires an exact bounded path without symbolic link directories');
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.size > maximum || info.mode & 0o002) {
      throw new Error('Native evidence must be a bounded, owned regular file');
    }
    return operation(descriptor, info);
  } finally { closeSync(descriptor); }
}

function readBytes(descriptor: number, size: number, position: number): Buffer {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, position + offset);
    if (!count) throw new Error('Native evidence changed during its bounded read');
    offset += count;
  }
  return bytes;
}

function parseJson(bytes: Uint8Array): unknown {
  const value: unknown = JSON.parse(decodeUtf8(bytes));
  if (!json(value)) throw new Error('Native evidence contains invalid Unicode JSON');
  return value;
}

export function nativeJson(path: string, maximum: number): unknown {
  return ownedFile(path, maximum, (descriptor, info) => {
    const bytes = readBytes(descriptor, info.size, 0);
    if (fstatSync(descriptor).size !== info.size) throw new Error('Native metadata changed during its bounded read');
    return parseJson(bytes);
  });
}

export const historyBoundary = check.object({ key: check.text(100), position: check.integer(),
  prefix: check.refine(check.text(64), value => /^[a-f0-9]{64}$/u.test(value), 'Invalid native history prefix digest') });
export type HistoryBoundary = check.Parsed<typeof historyBoundary>;
const MAX_INTERVAL = 8 * 1024 * 1024;
const READ_CHUNK = 64 * 1024;
const MAX_RECORD = 32 * 1024 * 1024;
export type HistoryInspection = { bytesRead: number; records: number; maximumBufferedBytes: number };

function missing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

function prefix(descriptor: number, position: number): string {
  return createHash('sha256').update(readBytes(descriptor, Math.min(position, 256), 0)).digest('hex');
}

export function historyHeader(path: string): unknown | undefined {
  try {
    return ownedFile(path, Number.MAX_SAFE_INTEGER, (descriptor, info) => {
      for (let size = Math.min(info.size, 4096); size; size = Math.min(size * 2, info.size, MAX_INTERVAL)) {
        const bytes = readBytes(descriptor, size, 0), end = bytes.indexOf(10);
        if (end >= 0) return parseJson(bytes.subarray(0, end));
        if (size === info.size) return undefined;
        if (size === MAX_INTERVAL) throw new Error('Native history header exceeds its verification bound');
      }
      return undefined;
    });
  } catch (error) { if (missing(error)) return undefined; throw error; }
}

export function captureHistory(path: string): HistoryBoundary | null {
  try {
    return ownedFile(path, Number.MAX_SAFE_INTEGER, (descriptor, info) => {
      let position = info.size;
      if (position && readBytes(descriptor, 1, position - 1)[0] !== 10) {
        const start = Math.max(0, position - MAX_INTERVAL);
        const end = readBytes(descriptor, position - start, start).lastIndexOf(10);
        if (end < 0 && start) throw new Error('Partial native history record exceeds its verification bound');
        position = start + end + 1;
      }
      return { key: String(info.dev) + ':' + String(info.ino), position, prefix: prefix(descriptor, position) };
    });
  } catch (error) { if (missing(error)) return null; throw error; }
}

export function historySince(path: string, boundary: HistoryBoundary | null, inspect: (record: unknown) => void): HistoryInspection {
  try {
    return ownedFile(path, Number.MAX_SAFE_INTEGER, (descriptor, info) => {
      if (boundary && (String(info.dev) + ':' + String(info.ino) !== boundary.key || info.size < boundary.position
        || prefix(descriptor, boundary.position) !== boundary.prefix)) throw new Error('Native history lost its publication boundary');
      const result: HistoryInspection = { bytesRead: 0, records: 0, maximumBufferedBytes: 0 };
      let position = boundary?.position ?? 0, length = 0, fragments: Buffer[] = [];
      while (position < info.size) {
        const chunk = readBytes(descriptor, Math.min(READ_CHUNK, info.size - position), position);
        position += chunk.length; result.bytesRead += chunk.length;
        for (let start = 0; start < chunk.length;) {
          const end = chunk.indexOf(10, start), stop = end < 0 ? chunk.length : end;
          if (stop > start) { fragments.push(chunk.subarray(start, stop)); length += stop - start; }
          if (length > MAX_RECORD) throw new Error('Native history record exceeds its verification bound');
          result.maximumBufferedBytes = Math.max(result.maximumBufferedBytes, 2 * length + 2 * READ_CHUNK);
          if (end < 0) break;
          if (length) {
            const line = fragments.length === 1 ? fragments[0]! : Buffer.concat(fragments, length);
            inspect(parseJson(line)); result.records++;
          }
          fragments = []; length = 0; start = end + 1;
        }
      }
      if (fstatSync(descriptor).size < info.size || boundary && prefix(descriptor, boundary.position) !== boundary.prefix) {
        throw new Error('Native history changed during receipt verification');
      }
      return result;
    });
  } catch (error) {
    if (boundary === null && missing(error)) return { bytesRead: 0, records: 0, maximumBufferedBytes: 0 };
    throw error;
  }
}
