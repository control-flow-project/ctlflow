import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, symlinkSync, mkdirSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createDaemonClient, operations } from '@ctlflow/fleet-daemon-client/client';

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
  const execute = promisify(execFile), env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(directory, 'config'), npm_config_cache: join(directory, 'npm-cache'), npm_config_registry: 'https://registry.invalid.test' };
  const packages: string[] = [];
  for (const name of ['fleetd', 'fleet']) {
    const packageRoot = dirname(fileURLToPath(import.meta.resolve('@ctlflow/' + name + '/package.json')));
    await execute('npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', directory], { cwd: packageRoot, env, timeout: 15000 });
    const file = readdirSync(directory).find(file => file.startsWith('ctlflow-' + name + '-') && file.endsWith('.tgz')); assert(file, 'Public tarball is produced'); packages.push(join(directory, file));
  }
  await execute('npm', ['install', '--prefix', prefix, '--ignore-scripts', '--omit=dev', '--offline', '--no-audit', '--no-fund', ...packages], { cwd: directory, env, timeout: 15000 });
  assert.deepEqual(readdirSync(join(prefix, 'node_modules', '@ctlflow')).sort(), ['fleet', 'fleetd']);
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
  const sourceAssets = dirname(fileURLToPath(import.meta.resolve('@ctlflow/fleetd/artifacts'))), installedAssets = join(prefix, 'node_modules', '@ctlflow', 'fleetd', 'dist', 'assets');
  assert.deepEqual(readdirSync(installedAssets).sort(), ['README.md', 'SKILL.md', 'crossfire-client.mjs', 'manifest.json', 'matrix-spec-LICENSE.txt']);
  for (const file of readdirSync(installedAssets)) assert.equal(readFileSync(join(installedAssets, file)).equals(readFileSync(join(sourceAssets, file))), true, 'Packed canonical artifact bytes: ' + file);
  await cli('daemon', 'stop');
  const deadline = Date.now() + 10000;
  while (existsSync(join(root, 'fleetd.sock'))) { assert(Date.now() < deadline, 'Installed controller stop exceeded deadline'); await delay(30); }
  await assert.rejects(cli('list'), /unavailable|Daemon request failed/u); assert.equal(existsSync(join(root, 'fleetd.sock')), false, 'Reading a stopped controller never restarts it');
});
