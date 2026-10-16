import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { target } from '../services/crossfire/node/packages/test-support/dist/contract-process.js';
import { containerStack } from '../services/crossfire/dist/tests/contracts/container-fixture.js';
import { serverContracts } from '../services/crossfire/dist/tests/contracts/server.contract.js';
import { browserContracts } from '../services/crossfire/dist/tests/contracts/browser.contract.js';
import { containerContracts } from '../services/crossfire/dist/tests/contracts/container.contract.js';
import { containerRecoveryContracts } from '../services/crossfire/dist/tests/contracts/container-recovery.contract.js';
import { verifyTestResources } from './test-resources.mjs';
import { readContractMatrix } from './contract-targets.mjs';

verifyTestResources();
const packages = process.env.CROSSFIRE_CONTAINER_PACKAGES;
if (!process.env.CROSSFIRE_CONTRACT_MATRIX || !process.env.CROSSFIRE_CONTRACT_TARGET || !process.env.CROSSFIRE_TEST_CGROUP_PARENT
  || !packages || !isAbsolute(packages)) throw new Error('Use the resource-bounded container matrix coordinator');
const targets = readContractMatrix(process.env.CROSSFIRE_CONTRACT_MATRIX).map(target);
const selected = targets.find(value => value.name === process.env.CROSSFIRE_CONTRACT_TARGET);
if (!selected) throw new Error('Selected implementation is absent from the validated matrix');
process.chdir(fileURLToPath(new URL('../services/crossfire/', import.meta.url)));
test('shared container contracts: ' + selected.name, { timeout: 3600000 }, async scope => {
  const platform = await containerStack(scope, selected, targets, packages);
  await scope.test('actual Element, artifacts and container contract', child => containerContracts(child, platform));
  await scope.test('identical Crossfire API and same-file contracts', child => serverContracts(child, platform));
  await scope.test('identical React contract', child => browserContracts(child, platform));
  assert.equal(platform.current().name, selected.name, 'Every target worker verifies its own installed operator');
  await scope.test('exclusive operator and abandoned container recovery', child => containerRecoveryContracts(child, platform));
  await platform.close();
});
