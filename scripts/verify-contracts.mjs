import { isAbsolute, join, resolve } from 'node:path';
import { buildProducts, repository, command, products } from './build.mjs';
import { readContractMatrix } from './contract-targets.mjs';
import { runContractTargets } from './contract-runner.mjs';
import { verifyTestResources } from './test-resources.mjs';

if (process.argv.length !== 3 || !isAbsolute(process.argv[2])) throw new Error('Use verify-contracts.mjs /absolute/implementation-matrix.json; every configured target runs the complete shared suite');
verifyTestResources(); const manifest = resolve(process.argv[2]); readContractMatrix(manifest);
await buildProducts(products);
await command(process.execPath, ['dist/scripts/architecture-proof/conduit-assets.js'], join(repository, 'services/crossfire'));
await command(process.execPath, ['dist/scripts/architecture-proof/pi-assets.js'], join(repository, 'services/crossfire'));
await runContractTargets({ manifest, worker: join(repository, 'scripts/contract-worker.mjs'), bank: 'contract-runs' });
