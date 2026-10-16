import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { verifyTestResources } from './test-resources.mjs';
import { readContractMatrix } from './contract-targets.mjs';
import { target } from '../services/crossfire/node/packages/test-support/dist/contract-process.js';
import { contractStack } from '../services/crossfire/dist/tests/contracts/fixture.js';
import { serverContracts } from '../services/crossfire/dist/tests/contracts/server.contract.js';
import { browserContracts } from '../services/crossfire/dist/tests/contracts/browser.contract.js';
import { ingressContracts } from '../services/crossfire/dist/tests/contracts/ingress.contract.js';
import { daemonContracts } from '../services/fleetd/dist/tests/contracts/daemon.contract.js';
import { cliContracts } from '../services/fleet/dist/tests/contracts/cli.contract.js';

verifyTestResources();
if (!process.env.CROSSFIRE_CONTRACT_MATRIX || !process.env.CROSSFIRE_CONTRACT_TARGET) throw new Error('Run through the unified contract matrix coordinator');
const targets = readContractMatrix(process.env.CROSSFIRE_CONTRACT_MATRIX).map(target), selected = targets.find(value => value.name === process.env.CROSSFIRE_CONTRACT_TARGET);
if (!selected) throw new Error('Selected implementation is absent from the validated matrix');
process.chdir(fileURLToPath(new URL('../services/crossfire/', import.meta.url)));
test('shared product contracts: ' + selected.name, { timeout: 780000 }, async scope => {
  const platform = await contractStack(scope, selected, targets);
  await scope.test('Crossfire HTTP, Matrix, security and persisted-data contracts', child => serverContracts(child, platform));
  for (const runtime of ['codex', 'pi']) await scope.test('fleetd lifecycle contract with actual ' + runtime, child => daemonContracts(child, platform, selected, runtime));
  await scope.test('Fleet CLI contract', child => cliContracts(child, platform, selected));
  await scope.test('Shared React contract', child => browserContracts(child, platform));
  await scope.test('Trusted ingress contract', child => ingressContracts(child, platform));
  await platform.close();
  scope.diagnostic(JSON.stringify({ target: selected.name, implementation: selected.implementation, runtimeAdapters: ['codex', 'pi'], matrixTargets: targets.map(value => value.name), data: join(platform.state, 'management.sqlite') }));
});
