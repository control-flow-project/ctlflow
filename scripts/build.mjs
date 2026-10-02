import { spawn } from 'node:child_process';
import { readdirSync, rmSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';

export const products = ['crossfire', 'fleetd', 'fleet'];
export const repository = fileURLToPath(new URL('../', import.meta.url));

export function command(binary, arguments_, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, arguments_, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(binary + ' failed: ' + (signal ?? code))));
  });
}

export async function typecheckProducts(selected) {
  const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
  await Promise.all(selected.flatMap(service => {
    const root = join(repository, 'services', service);
    const configurations = service === 'crossfire' ? ['tsconfig.core.json', 'apps/web/tsconfig.json'] : ['tsconfig.json'];
    return configurations.map(configuration => command(process.execPath, [compiler, '-p', configuration, '--noEmit'], root));
  }));
}

async function buildPackages() {
  const jobs = [];
  for (const service of products) {
    const packages = join(repository, 'services', service, 'packages');
    for (const name of readdirSync(packages)) {
      const source = join(packages, name, 'src'), output = join(packages, name, 'dist');
      if (!existsSync(source)) continue;
      rmSync(output, { recursive: true, force: true });
      const files = readdirSync(source, { recursive: true });
      const entries = files.filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts')).map(file => join(source, file));
      jobs.push((async () => {
        if (entries.length) await bundle({ entryPoints: entries, outdir: output, outbase: source, platform: 'node', format: 'esm', target: 'node26' });
        for (const file of files.filter(file => file.endsWith('.json'))) {
          mkdirSync(dirname(join(output, file)), { recursive: true }); copyFileSync(join(source, file), join(output, file));
        }
      })());
    }
  }
  await Promise.all(jobs);
}

async function buildProduct(service) {
  const root = join(repository, 'services', service), entries = [];
  rmSync(join(root, 'dist'), { recursive: true, force: true });
  for (const directory of ['apps', 'tests', 'scripts']) {
    const base = join(root, directory);
    if (!existsSync(base)) continue;
    for (const file of readdirSync(base, { recursive: true })) {
      if (!file.endsWith('.ts') || file.endsWith('.d.ts') || (file.startsWith('architecture-proof/') && file.endsWith('.test.ts')) || file === 'verify-architecture.ts') continue;
      entries.push(join(base, file));
    }
  }
  await bundle({ entryPoints: entries, outdir: join(root, 'dist'), outbase: root, platform: 'node', format: 'esm', target: 'node26' });
  if (service === 'crossfire') await command(process.execPath, [join(root, 'dist/scripts/build-release.js'), '--root', root], root);
}

export async function buildProducts(selected) {
  if (!selected.length || selected.some(service => !products.includes(service))) throw new Error('Select an existing product');
  await typecheckProducts(selected);
  await buildPackages();
  await Promise.all(selected.map(buildProduct));
}
