import { isAbsolute } from 'node:path';
import { buildProducts, command, products, repository } from './build.mjs';
import { withDockerTestResources } from './docker-test-resources.mjs';
import { readContractMatrix } from './contract-targets.mjs';

if (process.argv.length !== 3 || !isAbsolute(process.argv[2])) throw new Error('Supply the explicit shared implementation matrix JSON');
const file = process.argv[2]; readContractMatrix(file);
await buildProducts(products);
await withDockerTestResources(parent => command('systemd-run', ['--user', '--scope', '--quiet', '--slice=' + parent,
  '--setenv=CROSSFIRE_TEST_CGROUP_PARENT=' + parent, '--setenv=CROSSFIRE_CONTRACT_MATRIX=' + file,
  process.execPath, '--test', '--test-reporter=spec', 'scripts/container-worker.mjs'], repository));
