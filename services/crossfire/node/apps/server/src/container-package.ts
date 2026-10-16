import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { captureDocker, runDocker } from './container-commands.js';

export type ContainerPackage = { schemaVersion: 1; version: string; sourceDigest: string; backend: string; platform: 'linux/amd64'; archiveSha256: string; runtimeImage: string; migrationImage: string };
const keys = ['schemaVersion', 'version', 'sourceDigest', 'backend', 'platform', 'archiveSha256', 'runtimeImage', 'migrationImage'].sort().join(',');
const digest = /^[a-f0-9]{64}$/u, image = /^sha256:[a-f0-9]{64}$/u;

export function containerPackage(input: unknown): ContainerPackage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid container package manifest');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== keys || value.schemaVersion !== 1 || value.platform !== 'linux/amd64'
    || typeof value.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/u.test(value.version)
    || typeof value.backend !== 'string' || value.backend === 'migrations' || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.backend)
    || !['sourceDigest', 'archiveSha256'].every(key => typeof value[key] === 'string' && digest.test(value[key]))
    || !['runtimeImage', 'migrationImage'].every(key => typeof value[key] === 'string' && image.test(value[key]))
    || value.runtimeImage === value.migrationImage) throw new Error('Invalid container package manifest');
  return value as ContainerPackage;
}

export async function fileDigest(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path, { signal })) hash.update(bytes);
  return hash.digest('hex');
}

export function packageLabels(value: Pick<ContainerPackage, 'version' | 'sourceDigest'>, backend: string): Record<string, string> {
  return { 'org.crossfire.package': '1', 'org.opencontainers.image.version': value.version, 'org.crossfire.source': value.sourceDigest, 'org.crossfire.backend': backend };
}

export async function prepareContainerPackage(directory: string, signal: AbortSignal): Promise<ContainerPackage> {
  const root = resolve(directory), manifest = join(root, 'release.json'), archive = join(root, 'images.tar');
  for (const [path, maximum] of [[manifest, 8192], [archive, 17179869184]] as const) {
    const status = lstatSync(path);
    if (!status.isFile() || status.size < 1 || status.size > maximum) throw new Error('Container package files must be bounded regular files');
  }
  const value = containerPackage(JSON.parse(readFileSync(manifest, 'utf8')) as unknown);
  signal.throwIfAborted();
  if (await fileDigest(archive, signal) !== value.archiveSha256) throw new Error('Container package archive SHA-256 does not match');
  const selections = [[value.runtimeImage, value.backend], [value.migrationImage, 'migrations']] as const;
  const present = await Promise.all(selections.map(async ([identity]) => (await captureDocker(['image', 'inspect', identity], signal)).code === 0));
  if (present.some(item => !item)) await runDocker(['load', '--input', archive], signal);
  for (const [identity, backend] of selections) {
    const inspected = await captureDocker(['image', 'inspect', identity], signal);
    if (inspected.code !== 0) throw new Error('Container package is missing its exact image');
    const values = JSON.parse(inspected.output) as unknown;
    if (!Array.isArray(values) || values.length !== 1) throw new Error('Container package image inspection is ambiguous');
    const found = values[0] as { Id?: unknown; Os?: unknown; Architecture?: unknown; Config?: { Labels?: Record<string, unknown> } };
    if (found.Id !== identity || found.Os !== 'linux' || found.Architecture !== 'amd64'
      || Object.entries(packageLabels(value, backend)).some(([key, expected]) => found.Config?.Labels?.[key] !== expected)) throw new Error('Container package image identity, platform or release labels do not match');
  }
  return value;
}
