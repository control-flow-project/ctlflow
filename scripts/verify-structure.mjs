import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTestTiming } from './verify-test-timing.mjs';
import { testOptions, runtimeTestEnabled } from './test-options.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
assert.deepEqual(readdirSync(join(root, 'services')).sort(), ['crossfire', 'fleet', 'fleetd']);
for (const name of ['apps', 'packages', 'tests', 'skills', 'src', 'third-party']) {
  assert(!existsSync(join(root, name)) || readdirSync(join(root, name)).length === 0, 'Root application directory: ' + name);
}
for (const name of ['crossfire', 'fleetd', 'fleet']) {
  const directory = join(root, 'services', name);
  assert(existsSync(join(directory, 'AGENTS.md')), 'Missing ownership instructions: ' + name);
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, 'module');
}
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.deepEqual(manifest.workspaces, ['services/*', 'services/*/apps/*', 'services/*/packages/*']);
console.log('Structure verified: service-local Crossfire, fleetd and fleet; no root application/package pool.');
verifyTestTiming(root);
const defaults = testOptions([]), allRuntimes = testOptions(['--all-runtimes']);
assert.deepEqual(defaults, { allRuntimes: false });
assert.deepEqual(allRuntimes, { allRuntimes: true });
for (const file of ['claude-connection.test.js', 'claude-native-proof.test.js', 'pi-adapter.test.js',
  'pi-native-proof.test.js', 'pi-reload.test.js', 'pi-listener.test.js', 'native-setup.test.js']) {
  assert.equal(runtimeTestEnabled(join(root, file), defaults), false);
  assert.equal(runtimeTestEnabled(join(root, file), allRuntimes), true);
}
for (const file of ['codex.test.js', 'native-owned-runtime.test.js', 'wake-up-native.test.js', 'browser.test.js', 'controller.test.js']) {
  assert.equal(runtimeTestEnabled(file, defaults), true);
}
assert.throws(() => testOptions(['--unknown']), /only optional test flag/u);
assert.throws(() => testOptions(['--all-runtimes', '--all-runtimes']), /only optional test flag/u);
console.log('Test selection verified: Codex by default; Claude and Pi require --all-runtimes.');
