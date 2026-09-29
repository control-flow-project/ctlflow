import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const service = process.argv[2];
if (!['crossfire', 'fleetd', 'fleet'].includes(service)) throw new Error('Select one product');
const repository = fileURLToPath(new URL('../', import.meta.url)), root = join(repository, 'services', service);
execFileSync(process.execPath, [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '-p', service === 'crossfire' ? 'tsconfig.core.json' : 'tsconfig.json', '--noEmit'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [join(repository, 'scripts/build-packages.mjs')], { cwd: repository, stdio: 'inherit' });
rmSync(join(root, 'dist'), { recursive: true, force: true });
const entries = [];
for (const directory of ['apps', 'tests', 'scripts']) {
  const base = join(root, directory);
  if (!existsSync(base)) continue;
  for (const file of readdirSync(base, { recursive: true })) {
    if (!file.endsWith('.ts') || file.endsWith('.d.ts') || file.startsWith('web/') || (file.startsWith('architecture-proof/') && file.endsWith('.test.ts')) || file === 'verify-architecture.ts') continue;
    entries.push(join(base, file));
  }
}
await build({ entryPoints: entries, outdir: join(root, 'dist'), outbase: root, platform: 'node', format: 'esm', target: 'node26' });
if (service === 'crossfire') execFileSync(process.execPath, [join(root, 'dist/scripts/build-release.js'), '--root', root], { cwd: root, stdio: 'inherit' });
