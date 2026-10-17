import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containerPackage, fileDigest, packageLabels, prepareContainerPackage } from '../apps/server/src/container-package.js';
import { auditContainerDependencies, containerSourceDigest } from '../scripts/container-packages.js';

const value = { schemaVersion: 1, version: '0.1.20', sourceDigest: 'a'.repeat(64), backend: 'csharp-nativeaot', platform: 'linux/amd64', archiveSha256: 'b'.repeat(64), runtimeImage: 'sha256:' + 'c'.repeat(64), migrationImage: 'sha256:' + 'd'.repeat(64) };

test('container source identity covers all selected Rust workspace and toolchain inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-source-'));
  const inputs = ['.dockerignore', '.npmrc', 'LICENSE', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'global.json', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'Crossfire.CSharp.slnx', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'];
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
  for (const change of [{ extra: true }, { schemaVersion: 2 }, { platform: 'linux/arm64' }, { backend: '../node' }, { backend: 'migrations' }, { version: '' }, { sourceDigest: 'A'.repeat(64) }, { archiveSha256: null }, { runtimeImage: 'mutable:latest' }, { migrationImage: value.runtimeImage }]) {
    assert.throws(() => containerPackage({ ...value, ...change }), /Invalid container package/u);
  }
  for (const key of Object.keys(value)) { const missing: Record<string, unknown> = { ...value }; delete missing[key]; assert.throws(() => containerPackage(missing), /Invalid container package/u); }
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
