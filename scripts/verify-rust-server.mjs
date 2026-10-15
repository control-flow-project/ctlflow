import assert from 'node:assert/strict';
import test from 'node:test';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { verifyTestResources } from './test-resources.mjs';
import { contractStack } from '../services/crossfire/dist/tests/contracts/fixture.js';
import { serverContracts } from '../services/crossfire/dist/tests/contracts/server.contract.js';
import { browserContracts } from '../services/crossfire/dist/tests/contracts/browser.contract.js';

verifyTestResources();
assert.equal(process.argv.length, 2, 'Build shared assets and the native Rust server, prepare the pinned Conduit asset once, then run this focused shared-contract gate');
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = join(root, '.temp'); mkdirSync(temporary, {recursive:true, mode:0o700});
process.env.TMPDIR = temporary; process.env.TMP = temporary; process.env.TEMP = temporary;
const executable = join(root, 'target/debug/crossfire'); accessSync(executable, constants.X_OK);
const target = {name:'rust', implementation:'rust', server:{binary:executable, arguments:[]}};
process.chdir(join(root, 'services/crossfire'));
test('Rust server: unchanged shared executable contracts', {timeout:240000}, async scope => {
  const fixture = await contractStack(scope, target, [target]);
  await scope.test('HTTP, Matrix, security and persisted data', child => serverContracts(child, fixture));
  await scope.test('Shared React browser', child => browserContracts(child, fixture));
  await fixture.close();
});
