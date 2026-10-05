import { openSync, closeSync, fstatSync, constants, readSync, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';

export function ownedFile<Value>(path: string, maximum: number, operation: (descriptor: number, information: Stats) => Value): Value {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.size > maximum || (info.mode & 0o002)) throw new Error('Native history must be a bounded, owned regular file');
    return operation(descriptor, info);
  } finally { closeSync(descriptor); }
}

export function nativeJson(path: string): unknown {
  return ownedFile(path, 64 * 1024, (descriptor, info) => {
    return JSON.parse(readBytes(descriptor, info.size, 0).toString()) as unknown;
  });
}

export const historyBoundary = check.object({ key: check.text(100), position: check.integer(), prefix: check.text(64) });
export type HistoryBoundary = check.Parsed<typeof historyBoundary>;
const MAX_HISTORY = 1024 * 1024 * 1024;
const MAX_INTERVAL = 8 * 1024 * 1024;
function readBytes(descriptor: number, size: number, position: number): Buffer {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, position + offset);
    if (!count) throw new Error('Native file changed during its bounded read');
    offset += count;
  }
  return bytes;
}
function prefix(descriptor: number, position: number): string {
  const bytes = readBytes(descriptor, Math.min(position, 256), 0);
  return createHash('sha256').update(bytes).digest('hex');
}

export function captureHistory(path: string): HistoryBoundary {
  return ownedFile(path, MAX_HISTORY, (descriptor, info) => {
    let position = info.size;
    if (position && readBytes(descriptor, 1, position - 1)[0] !== 10) {
      const start = Math.max(0, position - MAX_INTERVAL);
      const end = readBytes(descriptor, position - start, start).lastIndexOf(10);
      if (end < 0 && start) throw new Error('Partial native history record exceeds its verification bound');
      position = start + end + 1;
    }
    return { key: String(info.dev) + ':' + String(info.ino), position, prefix: prefix(descriptor, position) };
  });
}

export function historySince(path: string, boundary: HistoryBoundary, through?: HistoryBoundary): unknown[] {
  return ownedFile(path, MAX_HISTORY, (descriptor, info) => {
    if (String(info.dev) + ':' + String(info.ino) !== boundary.key || info.size < boundary.position
      || prefix(descriptor, boundary.position) !== boundary.prefix) throw new Error('Native history lost its publication boundary');
    if (through && (through.key !== boundary.key || through.position < boundary.position || through.position > info.size
      || prefix(descriptor, through.position) !== through.prefix)) throw new Error('Native observation lost its captured interval');
    const size = (through?.position ?? info.size) - boundary.position;
    if (size > MAX_INTERVAL) throw new Error('Native publication interval exceeds its verification bound');
    const bytes = readBytes(descriptor, size, boundary.position);
    const end = bytes.lastIndexOf(10);
    if (end < 0) return [];
    return bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as unknown);
  });
}
