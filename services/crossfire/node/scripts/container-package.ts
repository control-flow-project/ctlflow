import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { captureDocker, runDocker } from './container-docker.js';

export type PackageImage = { reference: string; configDigest: string; descriptorDigest: string };
export type ContainerPackage = { schemaVersion: 2; version: string; sourceDigest: string; backend: string; platform: 'linux/amd64'; archiveSha256: string; runtime: PackageImage; migration: PackageImage };
export type PreparedContainerPackage = { package: ContainerPackage; runtimeImage: string; migrationImage: string };
const keys = ['schemaVersion', 'version', 'sourceDigest', 'backend', 'platform', 'archiveSha256', 'runtime', 'migration'].sort().join(',');
const digest = /^[a-f0-9]{64}$/u, image = /^sha256:[a-f0-9]{64}$/u;

function packageImage(input: unknown): input is PackageImage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return Object.keys(value).sort().join(',') === 'configDigest,descriptorDigest,reference'
    && typeof value.reference === 'string' && /^crossfire-package:[a-f0-9]{64}$/u.test(value.reference)
    && typeof value.configDigest === 'string' && image.test(value.configDigest)
    && typeof value.descriptorDigest === 'string' && image.test(value.descriptorDigest);
}

export function containerPackage(input: unknown): ContainerPackage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid container package manifest');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== keys || value.schemaVersion !== 2 || value.platform !== 'linux/amd64'
    || typeof value.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/u.test(value.version)
    || typeof value.backend !== 'string' || value.backend === 'migrations' || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.backend)
    || !['sourceDigest', 'archiveSha256'].every(key => typeof value[key] === 'string' && digest.test(value[key]))
    || !packageImage(value.runtime) || !packageImage(value.migration)
    || value.runtime.reference === value.migration.reference || value.runtime.configDigest === value.migration.configDigest
    || value.runtime.descriptorDigest === value.migration.descriptorDigest) throw new Error('Invalid container package manifest');
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

export function nativeImageIdentity(expected: PackageImage, input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid container image inspection');
  const found = input as Record<string, unknown>, descriptor = found.Descriptor;
  let expectedIdentity = expected.configDigest;
  if (descriptor !== undefined && descriptor !== null) {
    if (typeof descriptor !== 'object' || Array.isArray(descriptor)) throw new Error('Invalid container image descriptor');
    const value = descriptor as Record<string, unknown>;
    if (value.digest !== expected.descriptorDigest || !['application/vnd.oci.image.manifest.v1+json', 'application/vnd.oci.image.index.v1+json',
      'application/vnd.docker.distribution.manifest.v2+json', 'application/vnd.docker.distribution.manifest.list.v2+json'].includes(String(value.mediaType))) throw new Error('Container image descriptor does not match');
    expectedIdentity = expected.descriptorDigest;
  }
  if (found.Id !== expectedIdentity) throw new Error('Container image identity does not match');
  return expectedIdentity;
}

export function packageImageIdentities(value: ContainerPackage, input: unknown): { runtimeImage: string; migrationImage: string } {
  if (!Array.isArray(input) || input.length !== 2) throw new Error('Container package image inspection is ambiguous');
  const selections = [[value.runtime, value.backend], [value.migration, 'migrations']] as const;
  const identities = selections.map(([selected, backend], index) => {
    const found = input[index] as { Os?: unknown; Architecture?: unknown; Config?: { Labels?: Record<string, unknown> } };
    const identity = nativeImageIdentity(selected, found);
    if (found.Os !== 'linux' || found.Architecture !== 'amd64'
      || Object.entries(packageLabels(value, backend)).some(([key, expected]) => found.Config?.Labels?.[key] !== expected)) throw new Error('Container package image identity, platform or release labels do not match');
    return identity;
  });
  return { runtimeImage: identities[0]!, migrationImage: identities[1]! };
}

export function readContainerPackage(directory: string): ContainerPackage {
  const manifest = resolve(directory, 'release.json'), status = lstatSync(manifest);
  if (!status.isFile() || status.size < 1 || status.size > 8192) throw new Error('Container package files must be bounded regular files');
  return containerPackage(JSON.parse(readFileSync(manifest, 'utf8')) as unknown);
}

export async function prepareContainerPackage(directory: string, signal: AbortSignal): Promise<PreparedContainerPackage> {
  const root = resolve(directory), archive = join(root, 'images.tar'), status = lstatSync(archive);
  if (!status.isFile() || status.size < 1 || status.size > 17179869184) throw new Error('Container package files must be bounded regular files');
  const value = readContainerPackage(root);
  signal.throwIfAborted();
  if (await fileDigest(archive, signal) !== value.archiveSha256) throw new Error('Container package archive SHA-256 does not match');
  const selections = [[value.runtime, value.backend], [value.migration, 'migrations']] as const;
  const present = await Promise.all(selections.map(async ([selected]) => (await captureDocker(['image', 'inspect', selected.reference], signal)).code === 0));
  if (present.some(item => !item)) await runDocker(['load', '--input', archive], signal);
  const images: unknown[] = [];
  for (const [selected] of selections) {
    const inspected = await captureDocker(['image', 'inspect', selected.reference], signal);
    if (inspected.code !== 0) throw new Error('Container package is missing its exact image');
    const values = JSON.parse(inspected.output) as unknown;
    if (!Array.isArray(values) || values.length !== 1) throw new Error('Container package image inspection is ambiguous');
    images.push(values[0]);
  }
  return { package: value, ...packageImageIdentities(value, images) };
}
