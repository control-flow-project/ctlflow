import assert from 'node:assert/strict';
import test from 'node:test';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, isAbsolute } from 'node:path';
import { verifyTestResources } from './test-resources.mjs';
import { command as runCommand } from './build.mjs';
import { contractStack } from '../services/crossfire/dist/tests/contracts/fixture.js';
import { daemonContracts } from '../services/fleetd/dist/tests/contracts/daemon.contract.js';
import { cliContracts } from '../services/fleet/dist/tests/contracts/cli.contract.js';

verifyTestResources();
const [distribution] = process.argv.slice(2);
assert(process.argv.length === 3 && isAbsolute(distribution), 'Use one exact prepared Rust distribution; no runtime selection or skip flags');
const root = fileURLToPath(new URL('../', import.meta.url)), temporary = join(root, '.temp');
mkdirSync(temporary, {recursive: true, mode: 0o700});
process.env.TMPDIR = temporary; process.env.TMP = temporary; process.env.TEMP = temporary;
const command = product => ({binary:join(distribution, product === 'server' ? 'crossfire/crossfire' : product === 'daemon' ? 'fleetd/fleetd' : 'fleet/fleet'),arguments:[]});
const target = {name:'rust', implementation:'rust', server:command('server'),daemon:command('daemon'),cli:command('cli')};
for (const product of ['server','daemon','cli']) accessSync(target[product].binary, constants.X_OK);
process.chdir(join(root,'services/crossfire'));
await runCommand(process.execPath, ['dist/scripts/architecture-proof/conduit-assets.js'], process.cwd());
await runCommand(process.execPath, ['dist/scripts/architecture-proof/pi-assets.js'], process.cwd());
test('Rust actual product contracts: shared assertion bank', {timeout:780000}, async scope => {
  const fixture = await contractStack(scope,target,[target]);
  for (const runtime of ['codex','pi']) await scope.test('Actual '+runtime+' fleetd contract', child => daemonContracts(child,fixture,target,runtime));
  await scope.test('Actual CLI and SSH contract', child => cliContracts(child,fixture,target));
  await fixture.close();
});
