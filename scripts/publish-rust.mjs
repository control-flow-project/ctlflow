import { accessSync, chmodSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildProducts, command, products, repository } from './build.mjs';
import { verifyTestResources } from './test-resources.mjs';
import { prepareTimezones } from '../services/crossfire/scripts/timezones.mjs';
import { execFileSync } from 'node:child_process';
import { stageRustLicenses } from './rust-licenses.mjs';
import { stageDistributionDocumentation } from './distribution-documentation.mjs';

const { values, positionals } = parseArgs({ options: { output: { type: 'string' }, profile: { type: 'string', default: 'release' } }, allowPositionals: true });
if (positionals.length || !values.output || !isAbsolute(values.output) || !['debug', 'release'].includes(values.profile)) throw new Error('Use publish-rust.mjs --output /absolute/new-directory [--profile debug|release]');
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This native distribution targets Linux x64');
const resources = verifyTestResources(), output = resolve(values.output), parent = dirname(output);
if (existsSync(output) || !existsSync(parent) || !lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) throw new Error('Use a new output directory inside an existing, non-symlink parent');
const stage = mkdtempSync(join(parent, '.crossfire-rust-publish-'));
try {
  const timezones = await prepareTimezones();
  await buildProducts(products);
  await command(process.execPath, ['services/crossfire/scripts/generate-native-pi-extension.mjs', '--check'], repository);
  await command('cargo', ['build', '--workspace', '--locked', ...(values.profile === 'release' ? ['--release'] : [])], repository);
  const metadata=JSON.parse(execFileSync('cargo',['metadata','--locked','--filter-platform','x86_64-unknown-linux-gnu','--format-version','1'],{cwd:repository,encoding:'utf8',maxBuffer:16*1024*1024,timeout:60000}));
  const notices=join(stage,'third-party-licenses');stageRustLicenses(metadata,notices);
  for (const [product, executable] of [['crossfire', 'crossfire'], ['fleetd', 'fleetd'], ['fleet', 'fleet']]) {
    const destination = join(stage, product); mkdirSync(destination);
    cpSync(join(repository, 'target', values.profile, executable), join(destination, executable));
    accessSync(join(destination, executable), constants.X_OK); chmodSync(join(destination, executable), 0o755);
    cpSync(join(repository, 'LICENSE'), join(destination, 'LICENSE'));
    cpSync(notices,join(destination,'third-party-licenses'),{recursive:true});
    if (product !== 'fleet') { cpSync(join(repository, 'target', values.profile, 'crossfire-native-guard'), join(destination, 'crossfire-native-guard')); chmodSync(join(destination, 'crossfire-native-guard'),0o755); }
  }
  const releases = join(repository, 'services/crossfire/dist/onboarding'), entries = readdirSync(releases);
  if (entries.length !== 1) throw new Error('Require exactly one shared, freshly built agent-tool release');
  const release = JSON.parse(readFileSync(join(releases, entries[0], 'manifest.json'), 'utf8'));
  cpSync(join(releases, entries[0]), join(stage, 'fleetd/artifacts'), { recursive: true });
  cpSync(releases, join(stage, 'crossfire/onboarding'), { recursive: true });
  cpSync(join(repository, 'services/crossfire/dist/web'), join(stage, 'crossfire/web'), { recursive: true });
  cpSync(timezones,join(stage,'crossfire/zoneinfo'),{recursive:true});
  cpSync(join(repository, 'LICENSE'), join(stage, 'LICENSE'));
  stageDistributionDocumentation(repository, stage, 'rust');
  writeFileSync(join(stage, 'distribution.json'), JSON.stringify({ schemaVersion: 1, implementation: 'rust', mode: 'native', profile: values.profile, platform: 'linux-x64', version: release.version, release: release.release, executables: { crossfire: 'crossfire/crossfire', fleetd: 'fleetd/fleetd', fleet: 'fleet/fleet' } }, null, 2) + '\n');
  renameSync(stage, output);
  console.log(JSON.stringify({ status: 'built-not-certified', output, resources, release: release.release, profile: values.profile }));
} finally { rmSync(stage, { recursive: true, force: true }); }
