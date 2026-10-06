import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { ARTIFACTS, type ArtifactName, type Manifest } from '@ctlflow/crossfire-contracts/release';
import { artifactHash, releaseHash } from '@ctlflow/crossfire-adapter-filesystem/release';
import { installSoftware, installedSoftware } from '@ctlflow/crossfire-adapter-crossfire/software';

function fixture(scope: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-controller-software-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'managed'); mkdirSync(root, { mode: 0o700 });
  function release(label: string) {
    const releaseDirectory = join(directory, label); mkdirSync(releaseDirectory, { mode: 0o700 });
    const files = Object.fromEntries(ARTIFACTS.map(name => [name, Buffer.from(label + ': ' + name)])) as Record<ArtifactName, Buffer>;
    const manifest: Manifest = { version: '0.1.0', release: '0.1.0-' + releaseHash(files),
      artifacts: Object.fromEntries(ARTIFACTS.map(name => [name, { bytes: files[name].length, sha256: artifactHash(files[name]) }])) as Manifest['artifacts'] };
    for (const name of ARTIFACTS) writeFileSync(join(releaseDirectory, name), files[name], { mode: 0o600 });
    writeFileSync(join(releaseDirectory, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    return { releaseDirectory, manifest, files };
  }
  return { directory, root, release };
}

test('controller software installs only immutable local package artifacts and activation is explicit', async scope => {
  const { root, release } = fixture(scope), first = release('first');
  assert.throws(() => installedSoftware(root), /previously approved/u);
  const software = await installSoftware(root, first.releaseDirectory);
  assert.equal(existsSync(join(root, 'client.mjs')), false);
  assert.equal(software.manifest.release, first.manifest.release); assert.equal(software.skill.changed, true);
  for (const name of ARTIFACTS) assert.deepEqual(readFileSync(join(root, 'software', first.manifest.release, name)), first.files[name]);
  software.activate();
  assert.equal(realpathSync(join(root, 'client.mjs')), software.file);
  assert.equal(installedSoftware(root).manifest.release, first.manifest.release);
  const repeated = await installSoftware(root, first.releaseDirectory);
  assert.equal(repeated.skill.changed, false); assert.equal(repeated.file, software.file);
  const next = release('next'), updated = await installSoftware(root, next.releaseDirectory);
  assert.equal(updated.skill.changed, true);
  assert.equal(installedSoftware(root).manifest.release, first.manifest.release, 'Preparing an update does not silently activate it');
  updated.activate(); assert.equal(installedSoftware(root).manifest.release, next.manifest.release);
});

test('corrupt or symlinked local artifacts never replace approved software or fetch a replacement', async scope => {
  const { directory, root, release } = fixture(scope), first = release('first');
  const software = await installSoftware(root, first.releaseDirectory); software.activate();
  const next = release('next'); writeFileSync(join(next.releaseDirectory, ARTIFACTS[0]!), 'corrupt');
  await assert.rejects(installSoftware(root, next.releaseDirectory), /manifest/u);
  assert.equal(installedSoftware(root).manifest.release, first.manifest.release);
  await assert.rejects(installSoftware(root, 'https://must-never-be-fetched.invalid'), /installed package release directory/u);
  const alias = join(directory, 'release-alias'); symlinkSync(first.releaseDirectory, alias);
  await assert.rejects(installSoftware(root, alias), /installed package release directory/u);
  writeFileSync(join(root, 'software', first.manifest.release, ARTIFACTS[0]!), 'corrupt');
  assert.throws(() => installedSoftware(root), /manifest/u);
  await assert.rejects(installSoftware(root, first.releaseDirectory), /manifest/u);
});

test('explicit replacement validates the selected release without interpreting previous release metadata', async scope => {
  const { root, release } = fixture(scope), first = release('first');
  const software = await installSoftware(root, first.releaseDirectory); software.activate();
  const previousDirectory = join(root, 'software', first.manifest.release);
  writeFileSync(join(previousDirectory, 'manifest.json'), JSON.stringify({ ...first.manifest,
    artifacts: { ...first.manifest.artifacts, 'retired.txt': { bytes: 1, sha256: artifactHash(Buffer.from('x')) } } }), { mode: 0o600 });
  const retained = join(root, 'retained-state.json'), bytes = Buffer.from('{"identity":"original","history":"original","cursor":"original"}\n');
  writeFileSync(retained, bytes, { mode: 0o600 });
  assert.throws(() => installedSoftware(root), /Missing or unknown fields/u);
  const next = release('next');
  const updated = await installSoftware(root, next.releaseDirectory);
  assert.equal(updated.skill.changed, true);
  assert.equal(realpathSync(join(root, 'client.mjs')), software.file, 'Preparation retains the previous entry');
  assert.throws(() => installedSoftware(root), /Missing or unknown fields/u, 'Recovery cannot run unsupported installed software');
  updated.activate();
  assert.equal(installedSoftware(root).manifest.release, next.manifest.release);
  assert.deepEqual(readFileSync(retained), bytes, 'Explicit replacement preserves unrelated private state');
});
