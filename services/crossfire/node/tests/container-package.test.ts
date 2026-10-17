import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containerPackage, fileDigest, nativeImageIdentity, packageLabels, prepareContainerPackage } from '../apps/server/src/container-package.js';
import { archiveImages, auditContainerDependencies, containerSourceDigest } from '../scripts/container-packages.js';

const runtime = { reference: 'crossfire-package:' + 'c'.repeat(64), configDigest: 'sha256:' + 'c'.repeat(64), descriptorDigest: 'sha256:' + 'e'.repeat(64) };
const migration = { reference: 'crossfire-package:' + 'd'.repeat(64), configDigest: 'sha256:' + 'd'.repeat(64), descriptorDigest: 'sha256:' + 'f'.repeat(64) };
const value = { schemaVersion: 2, version: '0.1.21', sourceDigest: 'a'.repeat(64), backend: 'csharp-nativeaot', platform: 'linux/amd64', archiveSha256: 'b'.repeat(64), runtime, migration };

test('container source identity covers all selected Rust workspace and toolchain inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-source-'));
  const inputs = ['.dockerignore', '.npmrc', 'LICENSE', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'global.json', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'Ctlflow.CSharp.slnx', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'];
  try {
    for (const name of inputs) writeFileSync(join(directory, name), name);
    for (const name of ['services', 'scripts']) mkdirSync(join(directory, name));
    const baseline = containerSourceDigest(directory);
    for (const name of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml']) {
      writeFileSync(join(directory, name), name + '-changed');
      assert.notEqual(containerSourceDigest(directory), baseline, name + ' must affect release identity');
      writeFileSync(join(directory, name), name);
      assert.equal(containerSourceDigest(directory), baseline);
    }
    mkdirSync(join(directory, 'services/target')); writeFileSync(join(directory, 'services/target/generated'), 'regenerable');
    assert.equal(containerSourceDigest(directory), baseline, 'Regenerated build output is not source');
    symlinkSync(join(directory, 'Cargo.toml'), join(directory, 'services/linked'));
    assert.throws(() => containerSourceDigest(directory), /symlink or special/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('package construction rejects an unsafe dependency audit before image construction', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-package-audit-')), previous = process.env.PATH;
  try {
    writeFileSync(join(directory, 'npm'), '#!' + process.execPath + '\nimport { writeFileSync } from "node:fs"; writeFileSync("arguments.json", JSON.stringify(process.argv.slice(2))); process.exit(17);', { mode: 0o700 });
    process.env.PATH = directory;
    await assert.rejects(auditContainerDependencies(directory));
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'arguments.json'), 'utf8')), ['audit', '--package-lock-only', '--omit=dev', '--audit-level=moderate']);
  } finally { process.env.PATH = previous; rmSync(directory, { recursive: true, force: true }); }
});

test('container package has one exact backend and immutable runtime/migration identities', () => {
  assert.deepEqual(containerPackage(value), value);
  assert.deepEqual(packageLabels(value, value.backend), { 'org.crossfire.package': '1', 'org.opencontainers.image.version': value.version, 'org.crossfire.source': value.sourceDigest, 'org.crossfire.backend': value.backend });
  assert.equal(containerPackage({ ...value, backend: 'rust' }).backend, 'rust', 'The format is independent of a backend implementation');
  for (const change of [{ extra: true }, { schemaVersion: 1 }, { platform: 'linux/arm64' }, { backend: '../node' }, { backend: 'migrations' }, { version: '' }, { sourceDigest: 'A'.repeat(64) }, { archiveSha256: null }, { runtime: { ...runtime, reference: 'mutable:latest' } }, { migration: runtime }, { runtimeImage: runtime.configDigest }]) {
    assert.throws(() => containerPackage({ ...value, ...change }), /Invalid container package/u);
  }
  for (const key of Object.keys(value)) { const missing: Record<string, unknown> = { ...value }; delete missing[key]; assert.throws(() => containerPackage(missing), /Invalid container package/u); }
  for (const changed of [{ extra: true }, { configDigest: 'invalid' }, { descriptorDigest: null }]) assert.throws(() => containerPackage({ ...value, runtime: { ...runtime, ...changed } }), /Invalid container package/u);
  for (const key of Object.keys(runtime)) { const missing: Record<string, unknown> = { ...runtime }; delete missing[key]; assert.throws(() => containerPackage({ ...value, runtime: missing }), /Invalid container package/u); }
});

test('native Docker identities preserve exact OCI objects on classic and containerd stores', () => {
  assert.equal(nativeImageIdentity(runtime, { Id: runtime.configDigest }), runtime.configDigest);
  assert.equal(nativeImageIdentity(runtime, { Id: runtime.configDigest, Descriptor: null }), runtime.configDigest);
  for (const mediaType of ['application/vnd.oci.image.manifest.v1+json', 'application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.v2+json', 'application/vnd.docker.distribution.manifest.list.v2+json']) {
    const descriptor = { digest: runtime.descriptorDigest, mediaType };
    assert.equal(nativeImageIdentity(runtime, { Id: runtime.descriptorDigest, Descriptor: descriptor }), runtime.descriptorDigest);
    assert.throws(() => nativeImageIdentity(runtime, { Id: runtime.configDigest, Descriptor: descriptor }), /identity/u);
  }
  for (const input of [{ Id: migration.configDigest }, { Id: runtime.configDigest, Descriptor: {} }, { Id: runtime.configDigest, Descriptor: [] },
    { Id: runtime.descriptorDigest, Descriptor: { digest: migration.descriptorDigest, mediaType: 'application/vnd.oci.image.manifest.v1+json' } },
    { Id: runtime.descriptorDigest, Descriptor: { digest: runtime.descriptorDigest, mediaType: 'unknown' } }]) assert.throws(() => nativeImageIdentity(runtime, input), /identity|descriptor/u);
});

test('exported archives retain both named images and verify their actual OCI metadata', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-package-metadata-')), archive = join(directory, 'images.tar');
  const metadata = join(directory, 'metadata'); mkdirSync(join(metadata, 'blobs/sha256'), { recursive: true });
  function blob(value: object): string {
    const bytes = JSON.stringify(value), hash = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(metadata, 'blobs/sha256', hash), bytes); return 'sha256:' + hash;
  }
  function publish(manifest: unknown, descriptors: unknown): void {
    writeFileSync(join(metadata, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(metadata, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: descriptors }));
    execFileSync('tar', ['-C', metadata, '-cf', archive, 'manifest.json', 'index.json', 'blobs']);
  }
  try {
    const configurations = [blob({ os: 'linux', architecture: 'amd64', name: 'runtime' }), blob({ os: 'linux', architecture: 'amd64', name: 'migration' })];
    const references = [runtime.reference, migration.reference], descriptors = configurations.map(configDigest => ({ digest: blob({ config: { digest: configDigest } }) }));
    const manifest = configurations.map((configDigest, index) => ({ Config: 'blobs/sha256/' + configDigest.slice(7), RepoTags: [references[index]] }));
    publish(manifest, descriptors);
    assert.deepEqual(await archiveImages(archive, references), references.map((reference, index) => ({ reference, configDigest: configurations[index], descriptorDigest: descriptors[index]!.digest })));
    publish(manifest, descriptors.slice(0, 1));
    await assert.rejects(archiveImages(archive, references), /retain every selected image/u);
    publish([{ ...manifest[0], RepoTags: null }, manifest[1]], descriptors);
    await assert.rejects(archiveImages(archive, references), /image reference/u);
    publish(manifest, [descriptors[0], descriptors[0]]);
    await assert.rejects(archiveImages(archive, references), /missing or ambiguous/u);
    writeFileSync(join(metadata, 'blobs/sha256', configurations[0]!.slice(7)), 'changed metadata'); publish(manifest, descriptors);
    await assert.rejects(archiveImages(archive, references), /digest does not match/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('archive verification streams exact bytes, respects cancellation and rejects unsafe files before Docker', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-package-unit-'));
  try {
    const archive = join(directory, 'images.tar'), bytes = Buffer.from('bounded archive'); writeFileSync(archive, bytes);
    assert.equal(await fileDigest(archive), createHash('sha256').update(bytes).digest('hex'));
    writeFileSync(join(directory, 'release.json'), JSON.stringify(value));
    await assert.rejects(prepareContainerPackage(directory, new AbortController().signal), /SHA-256/u);
    const stop = new AbortController(); stop.abort(); await assert.rejects(prepareContainerPackage(directory, stop.signal), { name: 'AbortError' });
    rmSync(archive); symlinkSync(join(directory, 'release.json'), archive);
    await assert.rejects(prepareContainerPackage(directory, new AbortController().signal), /bounded regular files/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
