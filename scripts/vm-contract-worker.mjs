import test from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { verifyTestResources } from './test-resources.mjs';
import { readContractMatrix } from './contract-targets.mjs';
import { target } from '../services/crossfire/packages/test-support/dist/contract-process.js';
import { vmSupervisorContracts } from '../services/fleetd/dist/tests/contracts/vm-supervisor.contract.js';
import { vmExecutionContracts } from '../services/fleetd/dist/tests/contracts/vm-execution.contract.js';

verifyTestResources();
const matrix = process.env.CROSSFIRE_CONTRACT_MATRIX, name = process.env.CROSSFIRE_CONTRACT_TARGET, file = process.env.CROSSFIRE_VM_FIXTURE;
if (!matrix || !name || !file || !isAbsolute(file) || statSync(file).size > 32768) throw new Error('Run through verify-vm.mjs with explicit target and VM fixture');
const selected = readContractMatrix(matrix).map(target).find(value => value.name === name);
if (!selected) throw new Error('Selected native target is missing');
const fixture = JSON.parse(readFileSync(file, 'utf8'));
if (!fixture || Object.keys(fixture).sort().join(',') !== 'binaries,image'
  || !fixture.image || Object.keys(fixture.image).sort().join(',') !== 'mounts,path,sha256'
  || typeof fixture.image.path !== 'string' || !isAbsolute(fixture.image.path) || !/^[a-f0-9]{64}$/u.test(fixture.image.sha256)
  || !Array.isArray(fixture.image.mounts) || fixture.image.mounts.some(value => typeof value !== 'string' || !isAbsolute(value))
  || !fixture.binaries || Object.keys(fixture.binaries).sort().join(',') !== 'codex,node,pi'
  || Object.values(fixture.binaries).some(value => typeof value !== 'string' || !isAbsolute(value))) throw new Error('Invalid current VM fixture: image(path,sha256,mounts), binaries(codex,node,pi)');
test('shared actual VM execution: ' + selected.name, { timeout: 880000 }, async scope => {
  await scope.test('failed startup and host ownership', child => vmSupervisorContracts(child, selected));
  await scope.test('real guests and native sessions', child => vmExecutionContracts(child, selected, fixture.image, fixture.binaries));
});
