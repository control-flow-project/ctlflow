import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { readPrivateBytes, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { prepareControllerRoot } from './controller-root.js';

export function configurationRoot(platform: NodeJS.Platform, home: string, xdg: string | undefined): string {
  if (!isAbsolute(home) || resolve(home) !== home) throw new Error('HOME must be an absolute normalized path');
  const directory = platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : platform === 'linux' ? xdg ?? join(home, '.config') : null;
  if (!directory || !isAbsolute(directory) || resolve(directory) !== directory) throw new Error('Select a supported OS and an absolute normalized configuration directory');
  return directory;
}

export function configurationDirectory(platform: NodeJS.Platform, home: string, xdg: string | undefined): string { return join(configurationRoot(platform, home, xdg), 'ctlflow'); }

export function currentConfigurationRoot(): string { return configurationRoot(process.platform, homedir(), process.env.XDG_CONFIG_HOME); }
export function authenticationPath(): string { return join(currentConfigurationRoot(), 'ctlflow', 'fleetd.json'); }

function settings(value: unknown): { schemaVersion: 1; authenticationKey?: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'schemaVersion' && key !== 'authenticationKey')
    || !('schemaVersion' in value) || value.schemaVersion !== 1
    || 'authenticationKey' in value && (typeof value.authenticationKey !== 'string' || !/^[a-f0-9]{64}$/u.test(value.authenticationKey))) {
    throw new Error('Invalid fleetd configuration; expected schemaVersion 1 and a 256-bit authenticationKey');
  }
  return 'authenticationKey' in value ? { schemaVersion: 1, authenticationKey: value.authenticationKey as string } : { schemaVersion: 1 };
}

export function decodeAuthentication(bytes: Uint8Array): { schemaVersion: 1; authenticationKey?: string } {
  try {
    if (bytes.byteLength > 4096) throw new Error();
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const selected = settings(JSON.parse(content) as unknown);
    const tokens = content.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]/gu) ?? [];
    const fields = new Set<string>();
    for (let index = 0; index < tokens.length; index++) if (tokens[index]!.startsWith('"') && tokens[index + 1] === ':') {
      const key = JSON.parse(tokens[index]!) as string;
      if (fields.has(key)) throw new Error();
      fields.add(key);
    }
    return selected;
  } catch { throw new Error('Invalid fleetd configuration; expected unique fields, schemaVersion 1 and a 256-bit authenticationKey'); }
}

function read(file: string): { schemaVersion: 1; authenticationKey?: string } | undefined {
  if (!isAbsolute(file) || resolve(file) !== file) throw new Error('Fleetd configuration path must be absolute and normalized');
  const information = lstatSync(file, { throwIfNoEntry: false });
  if (!information) return undefined;
  const parent = lstatSync(dirname(file));
  if (!parent.isDirectory() || parent.uid !== process.getuid!() || parent.mode & 0o077 || realpathSync(dirname(file)) !== dirname(file)
    || !information.isFile() || information.nlink !== 1) throw new Error('Fleetd configuration must be a private owned single-link file in a private directory');
  return decodeAuthentication(readPrivateBytes(file, 4096));
}

export function readAuthentication(file = authenticationPath()): string {
  const key = read(file)?.authenticationKey;
  if (!key) throw new Error('Fleetd authentication key is missing; start fleetd to initialize its configuration');
  return key;
}

export async function initializeAuthentication(file = authenticationPath()): Promise<string> {
  const current = read(file);
  if (current?.authenticationKey) return current.authenticationKey;
  prepareControllerRoot(dirname(file));
  const release = await acquireProcessLock(file, 10);
  try {
    const selected = read(file) ?? { schemaVersion: 1 as const };
    if (selected.authenticationKey) return selected.authenticationKey;
    const authenticationKey = randomBytes(32).toString('hex');
    writeJson(file, { ...selected, authenticationKey }, 4096);
    return readAuthentication(file);
  } finally { await release(); }
}

export function authenticated(header: string | undefined, key: string): boolean {
  const expected = Buffer.from('Bearer ' + key, 'ascii');
  const received = Buffer.from(header ?? '', 'utf8');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
