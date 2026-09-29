import { readdirSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const service of ['crossfire', 'fleetd', 'fleet']) {
  const packages = join(root, 'services', service, 'packages');
  for (const name of readdirSync(packages)) {
    const source = join(packages, name, 'src'), output = join(packages, name, 'dist');
    if (!existsSync(source)) continue;
    rmSync(output, { recursive: true, force: true });
    const files = readdirSync(source, { recursive: true });
    const entries = files.filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts')).map(file => join(source, file));
    if (entries.length) await build({ entryPoints: entries, outdir: output, outbase: source, platform: 'node', format: 'esm', target: 'node26' });
    for (const file of files.filter(file => file.endsWith('.json'))) { mkdirSync(dirname(join(output, file)), { recursive: true }); copyFileSync(join(source, file), join(output, file)); }
  }
}
