import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { onboardingGuide, setupDescriptor, setupDescriptorSchema } from '@ctlflow/crossfire-contracts/onboarding';
import { ARTIFACTS } from '@ctlflow/crossfire-contracts/release';
import { containerBackends } from '../services/crossfire/dist/scripts/container-packages.js';
import { containerPackage } from '../services/crossfire/dist/scripts/container-package.js';

const root = fileURLToPath(new URL('../', import.meta.url));
test('all three products have native implementations and no Node application or npm executable', () => {
  for (const product of ['crossfire', 'fleetd', 'fleet']) {
    assert.equal(existsSync(join(root, 'services', product, 'node')), false, product + ' has no retained Node implementation');
    const manifest = JSON.parse(readFileSync(join(root, 'services', product, 'package.json'), 'utf8'));
    assert.equal(manifest.private, true); assert.equal(manifest.bin, undefined); assert.equal(manifest.publishConfig, undefined);
    for (const language of ['csharp', 'rust']) assert(existsSync(join(root, 'services', product, language, 'apps')));
  }
  assert.equal(existsSync(join(root, 'services/crossfire/crossfire')), false);
});
test('setup uses an installed exact-version native product and rejects the removed npm product identifier', () => {
  const release = { version: '0.1.26', release: '0.1.26-' + 'a'.repeat(24), artifacts: Object.fromEntries(ARTIFACTS.map(name => [name, { bytes: 1, sha256: 'b'.repeat(64) }])) };
  const current = setupDescriptor('https://example.test', '@owner:example.test', release);
  assert.equal(setupDescriptorSchema(current).ok, true);
  assert.equal(setupDescriptorSchema({ ...current, package: { ...current.package, name: '@ctlflow/fleet' } }).ok, false);
  const guide = onboardingGuide(current.server, current.ownerBackendUserId, release);
  assert(guide.includes('fleet setup --descriptor'));
  assert(!guide.includes('npm install')); assert(!guide.includes('node_modules/.bin/fleet'));
  assert(guide.includes('never downloads or substitutes another implementation'));
});
test('container packages reject a Node runtime and initialization uses the explicitly selected native runtime', () => {
  assert.deepEqual(containerBackends, ['csharp-managed', 'csharp-nativeaot']);
  const image = value => ({ reference: 'crossfire-package:' + value.repeat(64), configDigest: 'sha256:' + value.repeat(64), descriptorDigest: 'sha256:' + value.repeat(64) });
  const value = { schemaVersion: 2, version: '0.1.26', sourceDigest: 'a'.repeat(64), platform: 'linux/amd64', archiveSha256: 'b'.repeat(64), runtime: image('c'), migration: image('d') };
  for (const backend of ['csharp-managed', 'csharp-nativeaot', 'rust']) assert.equal(containerPackage({ ...value, backend }).backend, backend);
  assert.throws(() => containerPackage({ ...value, backend: 'node' }));
  const compose = readFileSync(join(root, 'services/crossfire/docker/local/compose.yaml'), 'utf8');
  const initialize = compose.slice(compose.indexOf('  initialize:'), compose.indexOf('  migrate:'));
  assert(initialize.includes('CROSSFIRE_RUNTIME_IMAGE')); assert(!initialize.includes('entrypoint: [node'));
  const build = readFileSync(join(root, 'services/crossfire/Dockerfile.build'), 'utf8');
  assert(!/\bAS production\s*$/mu.test(build)); assert(!build.includes('dist/apps/server'));
});
