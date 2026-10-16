import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { target } from '../services/crossfire/node/packages/test-support/dist/contract-process.js';
import { containerStack } from '../services/crossfire/dist/tests/contracts/container-fixture.js';
import { serverContracts } from '../services/crossfire/dist/tests/contracts/server.contract.js';
import { browserContracts } from '../services/crossfire/dist/tests/contracts/browser.contract.js';
import { containerContracts } from '../services/crossfire/dist/tests/contracts/container.contract.js';
import { containerRecoveryContracts } from '../services/crossfire/dist/tests/contracts/container-recovery.contract.js';
import { verifyTestResources } from './test-resources.mjs';
import { readContractMatrix } from './contract-targets.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildContainerPackages } from './container-packages.mjs';

verifyTestResources();
if (!process.env.CROSSFIRE_CONTRACT_MATRIX || !process.env.CROSSFIRE_TEST_CGROUP_PARENT) throw new Error('Use the container matrix coordinator');
const targets = readContractMatrix(process.env.CROSSFIRE_CONTRACT_MATRIX).map(target);
process.chdir(fileURLToPath(new URL('../services/crossfire/', import.meta.url)));
test('shared container contracts', { timeout: 5400000 }, async scope => {
  const temporary = mkdtempSync(join(tmpdir(), 'crossfire-packages-'));
  scope.after(() => rmSync(temporary, { recursive: true, force: true }));
  const packages = join(temporary, 'packages');
  await buildContainerPackages(fileURLToPath(new URL('../', import.meta.url)), packages, process.env.CROSSFIRE_TEST_CGROUP_PARENT);
  for (const selected of targets) await scope.test(selected.name, { timeout: 3600000 }, async child => {
    const platform = await containerStack(child, selected, targets, packages);
    await child.test('actual Element, artifacts and container contract', nested => containerContracts(nested, platform));
    await child.test('identical Crossfire API and same-file contracts', nested => serverContracts(nested, platform));
    await child.test('identical React contract', nested => browserContracts(nested, platform));
    await child.test('exclusive operator and abandoned container recovery', nested => containerRecoveryContracts(nested, platform));
    await platform.close();
  });
});
