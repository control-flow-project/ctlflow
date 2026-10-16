import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { isAbsolute, dirname, join } from 'node:path';
import { containerSourceDigest, auditContainerDependencies, exportContainerPackage } from '../../dist/scripts/container-packages.js';
import { packageLabels } from '../../dist/apps/server/src/container-package.js';
import { cgroupArguments, captureDocker, runDocker } from '../../dist/apps/server/src/container-commands.js';

export async function buildRustContainerPackage(source, output, parent) {
  if (!isAbsolute(source) || !isAbsolute(output) || existsSync(output) || !lstatSync(dirname(output)).isDirectory()) throw new Error('Use an absolute source and a new package output in an existing directory');
  const resources = cgroupArguments(parent), sourceDigest = containerSourceDigest(source);
  const inputs = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'].map(name => [name, readFileSync(join(source, name))]);
  await auditContainerDependencies(source);
  const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
  const suffix = sourceDigest.slice(0, 20), assets = 'crossfire-assets:' + suffix;
  async function build(file, target, tag, backend, extra = []) {
    const labels = Object.entries(packageLabels({ version, sourceDigest }, backend)).flatMap(([key, value]) => ['--label', key + '=' + value]);
    await runDocker(['build', ...resources, '--platform', 'linux/amd64', '--file', join(source, file), '--target', target, '--tag', tag, ...labels, ...extra, source]);
    const inspected = await captureDocker(['image', 'inspect', '--format', '{{.Id}}', tag]);
    if (inspected.code !== 0 || !/^sha256:[a-f0-9]{64}$/u.test(inspected.output.trim())) throw new Error('Cannot identify built container image');
    return inspected.output.trim();
  }
  await build('services/crossfire/node/Dockerfile', 'assets', assets, 'assets');
  const migrations = await build('services/crossfire/node/Dockerfile', 'migrations', 'crossfire-migrations:' + suffix, 'migrations');
  const runtime = await build('services/crossfire/rust/Dockerfile', 'production', 'crossfire-rust:' + suffix, 'rust', ['--build-arg', 'CROSSFIRE_ASSETS_IMAGE=' + assets]);
  if (containerSourceDigest(source) !== sourceDigest || inputs.some(([name, bytes]) => !readFileSync(join(source, name)).equals(bytes))) throw new Error('Container source changed during package construction');
  await exportContainerPackage(runtime, migrations, output, readFileSync(join(source, 'services/crossfire/dist/container-package-tool.mjs')));
}
