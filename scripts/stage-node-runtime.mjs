import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repository } from './build.mjs';

export function runtimePackages(root) {
  const packages = new Map();
  for (const service of ['crossfire', 'fleetd', 'fleet']) {
    for (const kind of ['node/apps', 'node/packages', 'apps']) {
      const directory = join(root, 'services', service, kind);
      if (!existsSync(directory)) continue;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const path = join(directory, entry.name), manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
        if (packages.has(manifest.name)) throw new Error('Duplicate runtime package owner: ' + manifest.name);
        packages.set(manifest.name, { path, manifest });
      }
    }
    const database = join(root, 'services', service, 'database');
    if (existsSync(database)) {
      const manifest = JSON.parse(readFileSync(join(database, 'package.json'), 'utf8'));
      packages.set(manifest.name, { path: database, manifest });
    }
  }
  const needed = new Set(['@ctlflow/crossfire-server']);
  for (const name of needed) {
    const owner = packages.get(name);
    if (!owner) throw new Error('Missing runtime package owner: ' + name);
    for (const dependency of Object.keys(owner.manifest.dependencies ?? {})) if (dependency.startsWith('@ctlflow/')) needed.add(dependency);
  }
  return [...needed].map(name => packages.get(name));
}

export function stageNodeRuntime(root, output) {
  if (!isAbsolute(output) || existsSync(output)) throw new Error('Use a new absolute runtime staging directory');
  const owners = runtimePackages(root), names = new Set(owners.map(owner => owner.manifest.name));
  mkdirSync(output);
  for (const file of ['package.json', '.npmrc', 'LICENSE']) cpSync(join(root, file), join(output, file));
  cpSync(join(root, 'node_modules'), join(output, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  const links = join(output, 'node_modules/@ctlflow');
  for (const entry of readdirSync(links)) {
    if (!lstatSync(join(links, entry)).isSymbolicLink()) throw new Error('First-party runtime modules must have one workspace owner');
    if (!names.has('@ctlflow/' + entry)) rmSync(join(links, entry));
  }
  for (const { path, manifest } of owners) {
    const destination = join(output, relative(root, path));
    mkdirSync(destination, { recursive: true });
    for (const file of ['package.json', 'LICENSE']) cpSync(join(path, file), join(destination, file));
    if (manifest.name === '@ctlflow/crossfire-data') cpSync(join(path, 'management'), join(destination, 'management'), { recursive: true });
    else if (manifest.name !== '@ctlflow/crossfire-server') cpSync(join(path, 'dist'), join(destination, 'dist'), { recursive: true });
  }
  for (const directory of ['apps/server', 'web', 'onboarding']) {
    const destination = join(output, 'services/crossfire/dist', directory);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, 'services/crossfire/dist', directory), destination, { recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Use stage-node-runtime.mjs /absolute/new-directory');
  stageNodeRuntime(repository, process.argv[2]);
}
