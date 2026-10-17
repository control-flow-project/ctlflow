import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildContainerPackages as buildNodeCsharpPackages } from '../services/crossfire/dist/scripts/container-packages.js';
import { buildRustContainerPackage } from '../services/crossfire/rust/scripts/container-packages.mjs';

export async function buildContainerPackages(source, output, parent) {
  if (!isAbsolute(output) || existsSync(output)) throw new Error('Use a new absolute package output directory');
  const temporary = mkdtempSync(join(dirname(output), '.crossfire-all-containers-'));
  try {
    const stage = join(temporary, 'packages');
    await buildNodeCsharpPackages(source, stage, parent);
    await buildRustContainerPackage(source, join(stage, 'rust'), parent);
    renameSync(stage, output);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ options: { output: { type: 'string' }, 'cgroup-parent': { type: 'string' } }, allowPositionals: true });
  if (positionals.length || !values.output) throw new Error('Use package:containers --output /absolute/new-directory [--cgroup-parent EXISTING.slice]');
  await buildContainerPackages(fileURLToPath(new URL('../', import.meta.url)), values.output, values['cgroup-parent']);
  console.log('Built Docker packages: ' + values.output);
}
