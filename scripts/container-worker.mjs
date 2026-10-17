import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyTestResources } from './test-resources.mjs';
import { readContractMatrix } from './contract-targets.mjs';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildContainerPackages } from './container-packages.mjs';
import { runContractTargets } from './contract-runner.mjs';

verifyTestResources();
if (!process.env.CROSSFIRE_CONTRACT_MATRIX || !process.env.CROSSFIRE_TEST_CGROUP_PARENT) throw new Error('Use the container matrix coordinator');
const manifest = process.env.CROSSFIRE_CONTRACT_MATRIX; readContractMatrix(manifest);
const repository = fileURLToPath(new URL('../', import.meta.url));
const fixtureRoot = join(repository, '.temp'); mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 });
process.chdir(fileURLToPath(new URL('../services/crossfire/', import.meta.url)));
test('shared container contracts', { timeout: 5400000 }, async scope => {
  const temporary = mkdtempSync(join(fixtureRoot, 'container-packages-'));
  scope.after(() => rmSync(temporary, { recursive: true, force: true }));
  const packages = join(temporary, 'packages');
  await buildContainerPackages(repository, packages, process.env.CROSSFIRE_TEST_CGROUP_PARENT);
  await runContractTargets({ manifest, worker: fileURLToPath(new URL('./container-target.mjs', import.meta.url)), bank: 'container-runs',
    testTimeoutMs: 3600000, deadlineMs: 3780000, cleanupMs: 180000,
    environment: { CROSSFIRE_CONTAINER_PACKAGES: packages }, signal: scope.signal });
});
