import { isAbsolute, join } from 'node:path';
import { statSync } from 'node:fs';
import { buildProducts, products, repository } from './build.mjs';
import { readContractMatrix } from './contract-targets.mjs';
import { runContractTargets } from './contract-runner.mjs';
import { verifyTestResources } from './test-resources.mjs';

if (process.argv.length !== 4 || !process.argv.slice(2).every(isAbsolute))
  throw new Error('Use verify-vm.mjs /absolute/implementation-matrix.json /absolute/vm-fixture.json');
verifyTestResources();
const [manifest, fixture] = process.argv.slice(2);
readContractMatrix(manifest);
if (!statSync(fixture).isFile() || statSync(fixture).size > 32768) throw new Error('Use a bounded VM fixture JSON file');
await buildProducts(products);
await runContractTargets({ manifest, worker: join(repository, 'scripts/vm-contract-worker.mjs'), bank: 'contract-runs',
  testTimeoutMs: 900000, deadlineMs: 930000, parallelism: 1, environment: { CROSSFIRE_VM_FIXTURE: fixture } });
