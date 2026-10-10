import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, symlinkSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createDaemonClient, operations } from '@ctlflow/fleet-daemon-client/client';
import { piBinary } from '@ctlflow/crossfire-test-support/pi';
import { piProvider } from '@ctlflow/crossfire-test-support/pi-provider';

function installedFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(file => {
    const selected = join(directory, file), information = lstatSync(selected);
    assert.equal(information.isSymbolicLink(), false, 'Published package contains no symlink: ' + file);
    if (information.isDirectory()) return installedFiles(selected).map(child => join(file, child));
    assert.equal(information.isFile(), true, 'Published package contains only ordinary files: ' + file);
    return [file];
  });
}

test('installed fleetd symlink starts the exact private daemon and stops normally', { timeout: 15000 }, async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleetd-installed-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const installed = join(directory, 'fleetd'), root = join(directory, 'controller');
  symlinkSync(fileURLToPath(import.meta.resolve('@ctlflow/fleetd/executable')), installed);
  const child = spawn(process.execPath, [installed, '--root', root, '--name', 'installed-controller'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'close'); let output = '', errors = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { errors += String(chunk); });
  cleanup(scope, async () => { if (child.exitCode === null) child.kill('SIGTERM'); await ended; });
  const client = createDaemonClient(join(root, 'fleetd.sock'));
  const deadline = Date.now() + 10000;
  for (;;) {
    const result = await client.call(operations.status, {}, {});
    if (result.ok) { assert.equal(result.value.data.controller.name, 'installed-controller'); break; }
    assert.equal(child.exitCode, null, 'Installed daemon exited without starting: ' + output + errors);
    assert(Date.now() < deadline, 'Installed daemon did not publish its private endpoint');
    await delay(30);
  }
  assert.equal(JSON.parse(output.trim()).status, 'ready');
  child.kill('SIGTERM');
  assert.equal((await ended)[0], 0);
});

test('clean installed public tarballs resolve only public dependencies and own one reusable private controller', { timeout: 45000 }, async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-public-install-')), prefix = join(directory, 'toolchain'), home = join(directory, 'home'), root = join(directory, 'controller');
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true })); mkdirSync(home, { mode: 0o700 }); mkdirSync(prefix, { mode: 0o700 });
  const execute = promisify(execFile), env: NodeJS.ProcessEnv = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(directory, 'config'), npm_config_cache: join(directory, 'npm-cache'), npm_config_registry: 'https://registry.invalid.test' };
  const provider = await piProvider(scope), nativeBin = join(directory, 'native-bin'); mkdirSync(nativeBin, { mode: 0o700 });
  symlinkSync(piBinary(), join(nativeBin, 'pi')); env.PATH = nativeBin + ':' + (env.PATH ?? ''); env.PI_CODING_AGENT_DIR = provider.home;
  const packages: string[] = [];
  for (const name of ['fleetd', 'fleet']) {
    const packageRoot = dirname(fileURLToPath(import.meta.resolve('@ctlflow/' + name + '/package.json')));
    await execute('npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', directory], { cwd: packageRoot, env, timeout: 15000 });
    const file = readdirSync(directory).find(file => file.startsWith('ctlflow-' + name + '-') && file.endsWith('.tgz')); assert(file, 'Public tarball is produced'); packages.push(join(directory, file));
  }
  await execute('npm', ['install', '--prefix', prefix, '--ignore-scripts', '--omit=dev', '--offline', '--no-audit', '--no-fund', ...packages], { cwd: directory, env, timeout: 15000 });
  assert.deepEqual(readdirSync(join(prefix, 'node_modules', '@ctlflow')).sort(), ['fleet', 'fleetd']);
  for (const name of ['fleet', 'fleetd']) {
    const packageRoot = join(prefix, 'node_modules', '@ctlflow', name), sourceRoot = dirname(fileURLToPath(import.meta.resolve('@ctlflow/' + name + '/package.json')));
    const guides = readdirSync(join(sourceRoot, 'docs')); for (const guide of guides) assert.match(guide, /^[A-Za-z0-9-]+\.md$/u, 'Published guides contain only Markdown');
    const expected = ['LICENSE', 'README.md', 'package.json', join('dist', 'bin', name + '.mjs'), ...guides.map(file => join('docs', file)),
      ...(name === 'fleetd' ? ['README.md', 'SKILL.md', 'crossfire-client.mjs', 'manifest.json', 'matrix-spec-LICENSE.txt'].map(file => join('dist', 'assets', file)) : [])];
    assert.deepEqual(installedFiles(packageRoot).sort(), expected.sort(), 'Exact public files contain no source, tests, credentials or extra artifact path');
    const license = readFileSync(join(sourceRoot, 'LICENSE'), 'utf8');
    assert.equal(readFileSync(join(packageRoot, 'LICENSE'), 'utf8'), license, 'The installed public product includes the complete proprietary license');
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { license: string; author: string };
    assert.equal(manifest.license, 'SEE LICENSE IN LICENSE');
    assert.equal(manifest.author, 'Jeswin P Kumar <jeswinpk@agilehead.com>');
    if (name === 'fleetd') {
      assert(readFileSync(join(packageRoot, 'dist', 'assets', 'README.md'), 'utf8').endsWith(license), 'Standalone agent tools carry the full first-party license');
    }
    assert.deepEqual(readdirSync(join(packageRoot, 'docs')).sort(), guides.sort(), 'One canonical published guide directory');
    for (const file of ['README.md', ...guides.map(file => join('docs', file))]) {
      const content = readFileSync(join(packageRoot, file), 'utf8');
      assert.equal(content, readFileSync(join(sourceRoot, file), 'utf8'), 'Published canonical documentation bytes: ' + name + '/' + file);
      for (const match of content.matchAll(/\]\(([^)]+)\)/gu)) {
        const address = match[1]!; if (address.startsWith('https://') || address.startsWith('#')) continue;
        const target = resolve(dirname(join(packageRoot, file)), address.split('#')[0]!);
        assert.equal(target.startsWith(packageRoot + '/'), true, 'Local guide link stays within published package: ' + address);
        assert.equal(existsSync(target), true, 'Published guide link exists: ' + address);
      }
    }
  }
  const installed = join(prefix, 'node_modules', '.bin', 'fleet');
  const cli = (...args: string[]) => execute(installed, args, { cwd: directory, env, timeout: 15000 });
  assert((await cli('--help')).stdout.includes('fleet setup'));
  await assert.rejects(cli('--root', root, 'list'), /unavailable|Daemon request failed/u); assert.equal(existsSync(root), false, 'Read-only commands never create or start a controller');
  const first = JSON.parse((await cli('daemon', 'start', '--root', root, '--name', 'installed')).stdout) as { startedAt: number; controller: { name: string } };
  cleanup(scope, async () => { if (existsSync(join(root, 'fleetd.sock'))) await cli('daemon', 'stop'); });
  const repeated = JSON.parse((await cli('daemon', 'start', '--root', root, '--name', 'installed')).stdout) as { startedAt: number; controller: { name: string } };
  assert.deepEqual(repeated, first); assert.deepEqual(JSON.parse((await cli('list')).stdout), []);
  const restarted = JSON.parse((await cli('daemon', 'restart')).stdout) as { startedAt: number; controller: { name: string } };
  assert.equal(restarted.controller.name, 'installed'); assert.notEqual(restarted.startedAt, first.startedAt);
  const configuration = join(directory, 'pi-fleet'), definition = join(configuration, 'agents', 'worker');
  mkdirSync(definition, { recursive: true, mode: 0o700 });
  writeFileSync(join(configuration, 'runtime.toml'), 'fleet = "packaged-pi"\n[coordination]\nadapter = "crossfire"\nserver = "https://127.0.0.1:1"\nowner = "@owner:example.test"\n[[instances]]\nkey = "worker"\nname = "worker"\ndefinition = "worker"\nworkarea = "agents/worker/workarea/worker"\n', { mode: 0o600 });
  writeFileSync(join(definition, 'AGENTS.md'), 'Native bundle inspection only. No model work is authorized.\n', { mode: 0o600 });
  const agentFile = join(definition, 'agent.toml'), agentOptions = (model: string) => 'name = "Worker"\nruntime = "pi"\n[runtime_options]\nprovider = "fixture"\nmodel = "' + model + '"\nthinking_level = "medium"\n';
  writeFileSync(agentFile, agentOptions('unavailable-model'), { mode: 0o600 });
  const client = createDaemonClient(join(root, 'fleetd.sock'));
  const setup = () => client.call(operations.setup, {}, { workspace: directory, configuration: join(configuration, 'runtime.toml'),
    descriptor: { schemaVersion: 1, server: 'https://127.0.0.1:1', ownerMatrixId: '@owner:example.test', package: { name: '@ctlflow/fleet', version: '0.1.19' }, instructions: '' } });
  const rejected = await setup(); assert(!rejected.ok); assert.equal(rejected.error.code, 'invalid'); assert.match(rejected.error.message, /Unavailable Pi model/u);
  writeFileSync(agentFile, agentOptions('fixture-model'), { mode: 0o600 });
  const accepted = await setup(); assert(accepted.ok, 'Installed bundle admits native Pi and its exact instruction extension before enrollment');
  assert.equal(accepted.value.data.fleet.fleetKey, 'packaged-pi'); assert.equal(provider.requests.length, 0, 'Installed admission never prompts a model');
  const operationId = accepted.value.data.operation?.operationId; assert(operationId);
  const enrollmentDeadline = Date.now() + 10000;
  const readOperation = () => client.call(operations.operation, { operationId }, {});
  for (;;) {
    const operation: Awaited<ReturnType<typeof readOperation>> = await readOperation(); assert(operation.ok);
    if (operation.value.data.status === 'failed') { assert.deepEqual(operation.value.data.errors[0], { instanceKey: null, code: 'unavailable', message: 'API request failed' }); break; }
    assert(Date.now() < enrollmentDeadline, 'Fixture enrollment must stop at its unavailable loopback coordinator'); await delay(30);
  }
  assert.equal(provider.requests.length, 0);
  assert.equal(readdirSync(join(definition, 'workarea', 'worker')).some(name => name.startsWith('.pi-inspection-')), false, 'Installed inspection disposes native histories');
  const sourceAssets = dirname(fileURLToPath(import.meta.resolve('@ctlflow/fleetd/artifacts'))), installedAssets = join(prefix, 'node_modules', '@ctlflow', 'fleetd', 'dist', 'assets');
  assert.deepEqual(readdirSync(installedAssets).sort(), ['README.md', 'SKILL.md', 'crossfire-client.mjs', 'manifest.json', 'matrix-spec-LICENSE.txt']);
  for (const file of readdirSync(installedAssets)) assert.equal(readFileSync(join(installedAssets, file)).equals(readFileSync(join(sourceAssets, file))), true, 'Packed canonical artifact bytes: ' + file);
  await cli('daemon', 'stop');
  const deadline = Date.now() + 10000;
  while (existsSync(join(root, 'fleetd.sock'))) { assert(Date.now() < deadline, 'Installed controller stop exceeded deadline'); await delay(30); }
  await assert.rejects(cli('list'), /unavailable|Daemon request failed/u); assert.equal(existsSync(join(root, 'fleetd.sock')), false, 'Reading a stopped controller never restarts it');
});
