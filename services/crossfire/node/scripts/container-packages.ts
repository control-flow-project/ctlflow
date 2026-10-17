import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { cgroupArguments, captureDocker, runDocker } from '../apps/server/src/container-commands.js';
import { containerPackage, fileDigest, packageLabels, type PackageImage } from '../apps/server/src/container-package.js';

export const containerBackends = ['node', 'csharp-managed', 'csharp-nativeaot'] as const;

export async function auditContainerDependencies(source: string): Promise<void> {
  await promisify(execFile)('npm', ['audit', '--package-lock-only', '--omit=dev', '--audit-level=moderate'], { cwd: source, timeout: 60000, maxBuffer: 1048576 });
}

export async function archiveImages(archive: string, references: readonly string[]): Promise<PackageImage[]> {
  function object(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid exported container metadata');
    return input as Record<string, unknown>;
  }
  async function entry(path: string): Promise<string> {
    const result = await promisify(execFile)('tar', ['-xOf', archive, path], { encoding: 'utf8', timeout: 120000, maxBuffer: 1048576 });
    return result.stdout;
  }
  const manifest: unknown = JSON.parse(await entry('manifest.json')), index = object(JSON.parse(await entry('index.json')) as unknown);
  if (!Array.isArray(manifest) || manifest.length !== references.length || !Array.isArray(index.manifests) || index.manifests.length !== references.length) throw new Error('Export must retain every selected image and no other image');
  const cache = new Map<string, Record<string, unknown>>();
  async function blob(identity: unknown): Promise<Record<string, unknown>> {
    if (typeof identity !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(identity)) throw new Error('Invalid exported container digest');
    const previous = cache.get(identity); if (previous) return previous;
    const text = await entry('blobs/sha256/' + identity.slice(7));
    if ('sha256:' + createHash('sha256').update(text).digest('hex') !== identity) throw new Error('Exported container metadata digest does not match');
    const value = object(JSON.parse(text) as unknown); cache.set(identity, value); return value;
  }
  async function contains(descriptor: unknown, configDigest: string, depth: number): Promise<boolean> {
    if (depth > 8) throw new Error('Exported container descriptor nesting is invalid');
    const selected = object(descriptor), value = await blob(selected.digest);
    if (value.config !== undefined) return object(value.config).digest === configDigest;
    if (!Array.isArray(value.manifests)) throw new Error('Exported container descriptor has no image');
    const matches = await Promise.all(value.manifests.map(child => contains(child, configDigest, depth + 1)));
    return matches.some(Boolean);
  }
  const result: PackageImage[] = [];
  for (const reference of references) {
    const selected = manifest.map(object).filter(value => Array.isArray(value.RepoTags) && value.RepoTags.includes(reference));
    if (selected.length !== 1 || typeof selected[0]!.Config !== 'string' || !/^blobs\/sha256\/[a-f0-9]{64}$/u.test(selected[0]!.Config)) throw new Error('Export lost its selected image reference');
    const configDigest = 'sha256:' + selected[0]!.Config.slice('blobs/sha256/'.length);
    const configuration = await blob(configDigest);
    if (configuration.os !== 'linux' || configuration.architecture !== 'amd64') throw new Error('Exported container platform does not match');
    const matches = [];
    for (const descriptor of index.manifests) if (await contains(descriptor, configDigest, 0)) matches.push(object(descriptor));
    if (matches.length !== 1 || typeof matches[0]!.digest !== 'string') throw new Error('Exported container descriptor is missing or ambiguous');
    result.push({ reference, configDigest, descriptorDigest: matches[0]!.digest });
  }
  return result;
}

export async function exportContainerPackage(runtimeImage: string, migrationImage: string, output: string, tool: Uint8Array): Promise<void> {
  if (!isAbsolute(output) || existsSync(output) || !lstatSync(dirname(output)).isDirectory()) throw new Error('Use a new absolute package output in an existing directory');
  async function inspect(identity: string): Promise<{ Id: string; Os: string; Architecture: string; Config: { Labels: Record<string, string> } }> {
    if (!/^sha256:[a-f0-9]{64}$/u.test(identity)) throw new Error('Package exact immutable image IDs, not mutable tags');
    const result = await captureDocker(['image', 'inspect', identity]);
    const entries = result.code === 0 ? JSON.parse(result.output) as unknown : null;
    if (!Array.isArray(entries) || entries.length !== 1) throw new Error('Cannot inspect the package image');
    return entries[0] as { Id: string; Os: string; Architecture: string; Config: { Labels: Record<string, string> } };
  }
  const runtime = await inspect(runtimeImage), migration = await inspect(migrationImage), labels = runtime.Config.Labels;
  const version = labels['org.opencontainers.image.version'], sourceDigest = labels['org.crossfire.source'], backend = labels['org.crossfire.backend'];
  if (!version || !sourceDigest || !backend || runtimeImage === migrationImage) throw new Error('Container package images require distinct release identities');
  const release = { version, sourceDigest };
  if ([runtime, migration].some((selected, index) => selected.Id !== (index === 0 ? runtimeImage : migrationImage) || selected.Os !== 'linux' || selected.Architecture !== 'amd64'
    || Object.entries(packageLabels(release, index === 0 ? backend : 'migrations')).some(([key, expected]) => selected.Config.Labels[key] !== expected))) throw new Error('Container package images must belong to the same labeled release');
  const stage = mkdtempSync(join(dirname(output), '.crossfire-image-'));
  try {
    const references = [runtimeImage, migrationImage].map(identity => 'crossfire-package:' + identity.slice(7));
    for (const [index, identity] of [runtimeImage, migrationImage].entries()) await runDocker(['tag', identity, references[index]!]);
    const archive = join(stage, 'images.tar'); await runDocker(['save', '--output', archive, ...references]);
    const images = await archiveImages(archive, references);
    const value = containerPackage({ schemaVersion: 2, ...release, backend, platform: 'linux/amd64',
      archiveSha256: await fileDigest(archive), runtime: images[0], migration: images[1] });
    writeFileSync(join(stage, 'release.json'), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    writeFileSync(join(stage, 'package-tool.mjs'), tool, { mode: 0o600, flag: 'wx' });
    renameSync(stage, output);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

export function containerSourceDigest(source: string): string {
  const hash = createHash('sha256');
  const excluded = new Set(['node_modules', 'dist', 'bin', 'obj', 'target', '.temp', '.analysis']);
  function add(path: string): void {
    const status = lstatSync(path);
    if (status.isDirectory()) for (const name of readdirSync(path).sort()) { if (!excluded.has(name)) add(join(path, name)); }
    else if (status.isFile()) { const bytes = readFileSync(path); hash.update(JSON.stringify([relative(source, path), bytes.length])).update(bytes); }
    else throw new Error('Container build input cannot be a symlink or special file');
  }
  for (const file of ['.dockerignore', '.npmrc', 'LICENSE', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'global.json', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'Ctlflow.CSharp.slnx', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml']) add(join(source, file));
  for (const directory of ['services', 'scripts']) add(join(source, directory));
  return hash.digest('hex');
}

export async function buildContainerPackages(source: string, output: string, parent?: string): Promise<void> {
  if (!isAbsolute(source) || !isAbsolute(output) || existsSync(output) || !lstatSync(dirname(output)).isDirectory()) throw new Error('Use an absolute source and a new package output in an existing directory');
  const resources = cgroupArguments(parent), sourceDigest = containerSourceDigest(source);
  await auditContainerDependencies(source);
  const version = (JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as { version: string }).version;
  const release = { version, sourceDigest }, suffix = sourceDigest.slice(0, 20), dockerfile = join(source, 'services/crossfire/node/Dockerfile');
  const stage = mkdtempSync(join(dirname(output), '.crossfire-containers-'));
  const assets = 'crossfire-assets:' + suffix, migrations = 'crossfire-migrations:' + suffix;
  async function build(file: string, target: string, tag: string, backend: string, extra: string[] = []): Promise<string> {
    const labels = Object.entries(packageLabels(release, backend)).flatMap(([key, value]) => ['--label', key + '=' + value]);
    await runDocker(['build', ...resources, '--platform', 'linux/amd64', '--file', file, '--target', target, '--tag', tag, ...labels, ...extra, source]);
    const inspected = await captureDocker(['image', 'inspect', '--format', '{{.Id}}', tag]);
    if (inspected.code !== 0 || !/^sha256:[a-f0-9]{64}$/u.test(inspected.output.trim())) throw new Error('Cannot identify built container image');
    return inspected.output.trim();
  }
  try {
    await build(dockerfile, 'assets', assets, 'assets');
    const migrationImage = await build(dockerfile, 'migrations', migrations, 'migrations');
    for (const backend of containerBackends) {
      const runtimeImage = await build(backend === 'node' ? dockerfile : join(source, 'services/crossfire/csharp/Dockerfile'), backend === 'node' ? 'production' : backend.slice('csharp-'.length),
        'crossfire-' + backend + ':' + suffix, backend, backend === 'node' ? [] : ['--build-arg', 'CROSSFIRE_ASSETS_IMAGE=' + assets]);
      await exportContainerPackage(runtimeImage, migrationImage, join(stage, backend), readFileSync(join(source, 'services/crossfire/dist/container-package-tool.mjs')));
    }
    if (containerSourceDigest(source) !== sourceDigest) throw new Error('Container source changed during package construction');
    renameSync(stage, output);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
