import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTestTiming } from './verify-test-timing.mjs';
import { testOptions } from './test-options.mjs';
import { verifyPackageOwnership } from './verify-packages.mjs';
import { verifyCsharpArchitecture } from './verify-csharp-architecture.mjs';
import { verifyImplementationLayout } from './verify-implementation-layout.mjs';
import { verifyDocumentation } from './verify-documentation.mjs';
import { inventory } from './native-file-inventory.mjs';
import { verifyPrivateFiles } from './verify-private-files.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
verifyPrivateFiles(root);
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
assert.deepEqual(manifest.workspaces, ['services/*', 'services/*/apps/*', 'services/*/node/apps/*', 'services/*/node/packages/*', 'services/*/database']);
verifyPackageOwnership(root);
verifyCsharpArchitecture(root);
verifyImplementationLayout(root);
const nativeFiles = inventory();
console.log('Native file inventory verified: ' + nativeFiles.files.length + ' Node/C# files; ' + nativeFiles.rustFiles + ' Rust files; explicit semantic owners.');
verifyDocumentation(root);
console.log('Structure verified: service-local Crossfire, fleetd and fleet; no root application/package pool.');
verifyTestTiming(root);
assert.equal(testOptions([]), undefined);
assert.throws(() => testOptions(['--unknown']), /verify all implemented runtimes/u);
assert.throws(() => testOptions(['--all-runtimes']), /verify all implemented runtimes/u);
console.log('Test selection verified: Codex and Pi; obsolete runtime flags are rejected.');
