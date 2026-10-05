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

export function nativeJson(path: string, maximum: number): unknown {
  return ownedFile(path, maximum, (descriptor, info) => {
    const bytes = readBytes(descriptor, info.size, 0);
    if (fstatSync(descriptor).size !== info.size) throw new Error('Native metadata changed during its bounded read');
    return JSON.parse(bytes.toString('utf8')) as unknown;
  });
}

export const historyBoundary = check.object({ key: check.text(100), position: check.integer(),
  prefix: check.refine(check.text(64), value => /^[a-f0-9]{64}$/u.test(value), 'Invalid native history prefix digest') });
export type HistoryBoundary = check.Parsed<typeof historyBoundary>;
const MAX_INTERVAL = 8 * 1024 * 1024;

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
        if (end >= 0) return JSON.parse(bytes.subarray(0, end).toString('utf8')) as unknown;
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

export function historySince(path: string, boundary: HistoryBoundary | null): unknown[] {
  try {
    return ownedFile(path, Number.MAX_SAFE_INTEGER, (descriptor, info) => {
      if (boundary && (String(info.dev) + ':' + String(info.ino) !== boundary.key || info.size < boundary.position
        || prefix(descriptor, boundary.position) !== boundary.prefix)) throw new Error('Native history lost its publication boundary');
      const position = boundary?.position ?? 0, size = info.size - position;
      if (size > MAX_INTERVAL) throw new Error('Native publication interval exceeds its verification bound');
      const bytes = readBytes(descriptor, size, position), end = bytes.lastIndexOf(10);
      if (end < 0) return [];
      return bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as unknown);
    });
  } catch (error) { if (boundary === null && missing(error)) return []; throw error; }
}
