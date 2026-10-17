import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';

export const products = ['crossfire', 'fleetd', 'fleet'];
export const repository = fileURLToPath(new URL('../', import.meta.url));

export function productBuildClosure(selected) {
  if (!selected.length || selected.some(service => !products.includes(service))) throw new Error('Select an existing product');
  const manifests = new Map(products.map(service => [service, JSON.parse(readFileSync(join(repository, 'services', service, 'package.json'), 'utf8'))]));
  const names = new Map([...manifests].map(([service, manifest]) => [manifest.name, service]));
  const included = new Set(selected);
  for (const service of included) {
    const manifest = manifests.get(service);
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      const owner = names.get(dependency);
      if (owner !== undefined) included.add(owner);
    }
  }
  return products.filter(service => included.has(service));
}

export function command(binary, arguments_, cwd, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, arguments_, { cwd, env: environment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(binary + ' failed: ' + (signal ?? code))));
  });
}

export async function typecheckProducts(selected) {
  const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
  await Promise.all(selected.flatMap(service => {
    const root = join(repository, 'services', service);
    const configurations = service === 'crossfire' ? ['node/tsconfig.json', 'apps/web/tsconfig.json'] : ['node/tsconfig.json'];
    return configurations.map(configuration => command(process.execPath, [compiler, '-p', configuration, '--noEmit'], root));
  }));
}

async function buildPackages() {
  const jobs = [];
  for (const service of products) {
    const packages = join(repository, 'services', service, 'node/packages');
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
  for (const directory of ['apps', 'tests', 'scripts', 'tools']) {
    const base = join(root, 'node', directory);
    if (!existsSync(base)) continue;
    for (const file of readdirSync(base, { recursive: true })) {
      if (!file.endsWith('.ts') || file.endsWith('.d.ts') || (file.startsWith('architecture-proof/') && file.endsWith('.test.ts')) || file === 'verify-architecture.ts') continue;
      entries.push(join(base, file));
    }
  }
  await bundle({ entryPoints: entries, outdir: join(root, 'dist'), outbase: join(root, 'node'), platform: 'node', format: 'esm', target: 'node26' });
  const sharedTests = join(root, 'tests');
  for (const suite of existsSync(sharedTests) ? readdirSync(sharedTests) : []) {
    const directory = join(sharedTests, suite);
    await bundle({ entryPoints: readdirSync(directory).filter(file => file.endsWith('.ts')).map(file => join(directory, file)), outdir: join(root, 'dist/tests', suite), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node26' });
  }
  if (service === 'crossfire') {
    await bundle({ entryPoints: [join(root, 'node/scripts/container-package-tool.ts')], outfile: join(root, 'dist/container-package-tool.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node26' });
    await command(process.execPath, [join(root, 'dist/scripts/build-release.js'), '--root', root, '--web-directory', join(root, 'apps/web/dist')], root);
  }
  else await command(process.execPath, [join(root, 'node/scripts/build-package.mjs')], root);
}

export async function buildProducts(selected) {
  const owners = productBuildClosure(selected);
  await typecheckProducts(owners);
  await buildPackages();
  if (owners.includes('crossfire')) await command(process.execPath, ['scripts/build.mjs'], join(repository, 'services/crossfire/apps/web'));
  await Promise.all(owners.map(buildProduct));
}
