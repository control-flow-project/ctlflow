import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, writeFileSync, unlinkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { object } from '@crossfire/contracts/validation';
import { nativeJson } from './native-file.js';

export function projectConfiguration(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const result = object(nativeJson(path));
  if (!result.ok) throw new Error('Invalid project runtime configuration');
  return result.value;
}

export function saveProjectConfiguration(path: string, value: Record<string, unknown>): void {
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
  const info = lstatSync(parent);
  if (!info.isDirectory() || info.uid !== process.getuid!() || realpathSync(parent) !== resolve(parent)) throw new Error('Runtime configuration must stay in an owned project directory');
  if (existsSync(path)) nativeJson(path);
  const temporary = join(parent, '.crossfire-' + randomUUID());
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (bytes.length > 64 * 1024) throw new Error('Project runtime configuration exceeds its byte bound');
  try {
    const descriptor = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, path);
    const directory = openSync(parent, 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function shellQuote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
