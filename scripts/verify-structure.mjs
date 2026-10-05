import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTestTiming } from './verify-test-timing.mjs';
import { testOptions } from './test-options.mjs';
import { verifyPackageOwnership } from './verify-packages.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
assert.deepEqual(readdirSync(join(root, 'services')).sort(), ['crossfire', 'fleet', 'fleetd']);
for (const name of ['apps', 'packages', 'tests', 'skills', 'src', 'third-party']) {
  assert(!existsSync(join(root, name)) || readdirSync(join(root, name)).length === 0, 'Root application directory: ' + name);
}
for (const name of ['crossfire', 'fleetd', 'fleet']) {
  const directory = join(root, 'services', name);
  assert(existsSync(join(directory, 'AGENTS.md')), 'Missing ownership instructions: ' + name);
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.type, 'module');
}
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.deepEqual(manifest.workspaces, ['services/*', 'services/*/apps/*', 'services/*/packages/*']);
verifyPackageOwnership(root);
console.log('Structure verified: service-local Crossfire, fleetd and fleet; no root application/package pool.');
verifyTestTiming(root);
assert.equal(testOptions([]), undefined);
assert.throws(() => testOptions(['--unknown']), /only implemented runtime/u);
assert.throws(() => testOptions(['--all-runtimes']), /only implemented runtime/u);
console.log('Test selection verified: one Codex runtime; obsolete runtime flags are rejected.');
