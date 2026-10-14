import { accessSync, chmodSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildProducts, command, products, repository } from './build.mjs';
import { verifyTestResources } from './test-resources.mjs';

const { values, positionals } = parseArgs({ options: { output: { type: 'string' }, mode: { type: 'string' } }, allowPositionals: true });
if (positionals.length || !values.output || !isAbsolute(values.output) || !['managed', 'nativeaot'].includes(values.mode)) throw new Error('Use publish-csharp.mjs --output /absolute/new-directory --mode managed|nativeaot');
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This pinned distribution targets Linux x64');
const resources = verifyTestResources(), output = resolve(values.output), parent = dirname(output);
process.umask(0o022);
if (existsSync(output) || !existsSync(parent) || !lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) throw new Error('Use a new output directory inside an existing, non-symlink parent');
const stage = mkdtempSync(join(parent, '.crossfire-publish-')), dotnet = process.env.DOTNET_EXECUTABLE ?? 'dotnet';
process.env.DOTNET_CLI_DO_NOT_USE_MSBUILD_SERVER = '1'; process.env.MSBUILDDISABLENODEREUSE = '1'; process.env.UseSharedCompilation = 'false';
try {
  await buildProducts(products);
  await command(process.execPath, ['services/crossfire/scripts/generate-native-pi-extension.mjs', '--check'], repository);
  for (const [product, application, executable] of [['crossfire', 'Crossfire.Server', 'Crossfire.Server'], ['fleetd', 'Fleetd.Daemon', 'fleetd'], ['fleet', 'Fleet.Cli', 'fleet']]) {
    const destination = join(stage, product), project = join(repository, 'services', product, 'csharp/apps', application);
    mkdirSync(destination);
    await command(dotnet, ['publish', project, '--disable-build-servers', '-c', 'Release', '-r', 'linux-x64', '--self-contained', 'true', '-p:PublishAot=' + (values.mode === 'nativeaot'), '-p:UseAppHost=true', '-p:CppCompilerAndLinker=gcc', '-o', destination], repository);
    accessSync(join(destination, executable), constants.X_OK);
    chmodSync(join(destination, executable), 0o755);
    cpSync(join(repository, 'LICENSE'), join(destination, 'LICENSE'));
  }
  const releases = join(repository, 'services/crossfire/dist/onboarding'), entries = readdirSync(releases);
  if (entries.length !== 1) throw new Error('Require exactly one shared, freshly built agent-tool release');
  const release = JSON.parse(readFileSync(join(releases, entries[0], 'manifest.json'), 'utf8'));
  cpSync(join(releases, entries[0]), join(stage, 'fleetd/artifacts'), { recursive: true });
  cpSync(releases, join(stage, 'crossfire/onboarding'), { recursive: true });
  cpSync(join(repository, 'services/crossfire/dist/web'), join(stage, 'crossfire/web'), { recursive: true });
  cpSync(join(repository, 'LICENSE'), join(stage, 'LICENSE'));
  cpSync(join(repository, 'services/crossfire/csharp/README.md'), join(stage, 'README.md'));
  writeFileSync(join(stage, 'distribution.json'), JSON.stringify({ schemaVersion: 1, implementation: 'csharp', mode: values.mode, platform: 'linux-x64', version: release.version, release: release.release, executables: { crossfire: 'crossfire/Crossfire.Server', fleetd: 'fleetd/fleetd', fleet: 'fleet/fleet' } }, null, 2) + '\n');
  renameSync(stage, output);
  console.log(JSON.stringify({ status: 'built-not-certified', output, mode: values.mode, resources, release: release.release }));
} finally { rmSync(stage, { recursive: true, force: true }); }
