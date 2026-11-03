import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildContainerPackages } from './container-packages.js';

const { values, positionals } = parseArgs({ options: { output: { type: 'string' }, 'cgroup-parent': { type: 'string' } }, allowPositionals: true });
if (positionals.length || !values.output) throw new Error('Use package-containers --output /absolute/new-directory [--cgroup-parent EXISTING.slice]');
await buildContainerPackages(fileURLToPath(new URL('../../../../', import.meta.url)), values.output, values['cgroup-parent']);
console.log('Built Docker packages: ' + values.output);
