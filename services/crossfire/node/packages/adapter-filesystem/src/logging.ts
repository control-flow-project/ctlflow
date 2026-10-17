import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, renameSync, unlinkSync, writeSync, fsyncSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { DiagnosticLog } from '@ctlflow/crossfire-domain/port/logging';
import { DAY_MS, loggingRetentionDays } from '@ctlflow/crossfire-kernel/logging';
import { privateDir } from './index.js';

const recordBytes = 512 * 1024;
const messageBytes = 64 * 1024;

function openOwned(file: string, flags: number): number {
  const descriptor = openSync(file, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  const information = fstatSync(descriptor);
  if (!information.isFile() || information.uid !== process.getuid!() || information.mode & 0o077 || information.nlink !== 1) {
    closeSync(descriptor); throw new Error('Diagnostic logs must be private owned regular files without links');
  }
  return descriptor;
}
function unchanged(file: string, descriptor: number, before = fstatSync(descriptor)): void {
  const opened = fstatSync(descriptor), current = lstatSync(file);
  if (before.ino !== opened.ino || before.dev !== opened.dev || before.size !== opened.size || before.mtimeMs !== opened.mtimeMs
    || opened.ino !== current.ino || opened.dev !== current.dev || opened.size !== current.size || opened.mtimeMs !== current.mtimeMs)
    throw new Error('Diagnostic log changed during cleanup');
}
function append(descriptor: number, bytes: Buffer): void {
  let position = 0;
  while (position < bytes.length) {
    const written = writeSync(descriptor, bytes, position, bytes.length - position);
    if (written <= 0) throw new Error('Diagnostic write made no progress');
    position += written;
  }
}

async function trim(file: string, cutoff: number): Promise<void> {
  const input = openOwned(file, constants.O_RDONLY);
  const before = fstatSync(input);
  const temporary = file + '.pending-' + randomUUID();
  let output: number | undefined;
  try {
    output = openOwned(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    const buffer = Buffer.alloc(64 * 1024);
    let remaining = Buffer.alloc(0), position = 0;
    for (;;) {
      const count = readSync(input, buffer, 0, buffer.length, position);
      position += count;
      remaining = Buffer.concat([remaining, buffer.subarray(0, count)]);
      let newline: number;
      while ((newline = remaining.indexOf(10)) !== -1) {
        const line = remaining.subarray(0, newline);
        if (line.length > recordBytes) throw new Error('Diagnostic record exceeds its byte bound');
        const record: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
        if (!record || typeof record !== 'object' || !('at' in record) || typeof record.at !== 'number' || !Number.isSafeInteger(record.at))
          throw new Error('Invalid diagnostic record timestamp');
        if (record.at >= cutoff) append(output, remaining.subarray(0, newline + 1));
        remaining = remaining.subarray(newline + 1);
      }
      if (remaining.length > recordBytes) throw new Error('Diagnostic record exceeds its byte bound');
      if (!count) break;
      await yieldLoop();
    }
    if (remaining.length) throw new Error('Incomplete diagnostic record; retained for inspection');
    unchanged(file, input, before);
    fsyncSync(output);
    const empty = fstatSync(output).size === 0;
    closeSync(output); output = undefined;
    if (empty) unlinkSync(file); else renameSync(temporary, file);
  } finally {
    closeSync(input);
    if (output !== undefined) closeSync(output);
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
}

export function createDiagnosticLog(directory: string, days: number, now = Date.now): DiagnosticLog {
  const retention = loggingRetentionDays(days);
  if (!retention.ok) throw new Error(retention.error.message);
  privateDir(directory);
  let writeProblem: string | null = null, cleanupProblem: string | null = null, maintenanceProblem: string | null = null, closed = false;
  return {
    write(message) {
      if (closed) { writeProblem = 'Diagnostic log is closed'; return; }
      try {
        privateDir(directory);
        const at = now();
        if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(new Date(at).getTime())) throw new Error('Invalid diagnostic clock');
        const file = join(directory, new Date(at).toISOString().slice(0, 10) + '.jsonl');
        const descriptor = openOwned(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT);
        try {
          const bytes = Buffer.from(message), decoder = new StringDecoder('utf8');
          for (let position = 0; position < bytes.length || position === 0; position += messageBytes) {
            const part = decoder.write(bytes.subarray(position, position + messageBytes))
              + (position + messageBytes >= bytes.length ? decoder.end() : '');
            const record = Buffer.from(JSON.stringify({ at, message: part }) + '\n');
            if (record.length > recordBytes) throw new Error('Diagnostic record exceeds its byte bound');
            append(descriptor, record);
          }
        } finally { closeSync(descriptor); }
        writeProblem = null;
      } catch { writeProblem = 'Platform diagnostic logging is unavailable; inspect private logging storage'; }
    },
    async prune() {
      if (closed) return failure('unavailable', 'Diagnostic log is closed');
      try {
        privateDir(directory);
        const cutoff = now() - retention.value * DAY_MS;
        if (!Number.isSafeInteger(cutoff)) return failure('invalid', 'Invalid diagnostic retention cutoff');
        let failed = false;
        for (const name of readdirSync(directory)) {
          try {
            if (/^\d{4}-\d{2}-\d{2}\.jsonl\.pending-[a-f0-9-]{36}$/u.test(name)) {
              const file = join(directory, name), descriptor = openOwned(file, constants.O_RDONLY);
              try { if (fstatSync(descriptor).mtimeMs < cutoff) { unchanged(file, descriptor); unlinkSync(file); } }
              finally { closeSync(descriptor); }
              continue;
            }
            if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/u.test(name)) continue;
            const firstAt = new Date(name.slice(0, 10) + 'T00:00:00.000Z').getTime();
            if (!Number.isFinite(firstAt) || new Date(firstAt).toISOString().slice(0, 10) !== name.slice(0, 10)) throw new Error('Invalid diagnostic partition');
            if (firstAt >= cutoff) continue;
            const file = join(directory, name);
            if (firstAt + DAY_MS <= cutoff) {
              const descriptor = openOwned(file, constants.O_RDONLY);
              try { unchanged(file, descriptor); unlinkSync(file); } finally { closeSync(descriptor); }
            } else await trim(file, cutoff);
          } catch { failed = true; }
        }
        if (failed) throw new Error('One or more diagnostic files require inspection');
        cleanupProblem = null;
        return success(undefined);
      } catch { cleanupProblem = 'Platform diagnostic cleanup is unavailable; retained files require inspection'; return failure('unavailable', cleanupProblem); }
    },
    maintenanceError(message) { maintenanceProblem = message; },
    error: () => writeProblem ?? cleanupProblem ?? maintenanceProblem,
    close() { closed = true; },
  };
}
