import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './instance.ts';
import { buildInfo, requireNode } from './version.ts';

const execute = promisify(execFile);

test('Node admission consistently requires 26 or newer', () => {
  for (const version of ['22.18.0', '24.9.0', '25.9.9', '', 'invalid', '26', 'Infinity.0.0']) {
    assert.throws(() => requireNode(version), /Node.js 26\+ is required/);
  }
  for (const version of ['26.0.0', '26.8.1', '27.0.0']) requireNode(version);
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines.node, '>=26.0.0');
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')).packages[''].engines.node, '>=26.0.0');
  assert.equal(readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim(), '26');
  assert.match(readFileSync(join(ROOT, 'Dockerfile'), 'utf8'), /^FROM node:26-alpine@sha256:[a-f0-9]{64}$/m);
});

test('build identity reports the actual checkout without changing it', () => {
  const build = buildInfo(ROOT, 'test-image');
  const git = (args: string[]) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
  assert.equal(build.version, JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
  assert.equal(build.revision, git(['rev-parse', 'HEAD']));
  assert.equal(build.modified, git(['status', '--porcelain', '--untracked-files=normal']) !== '');
  assert.equal(build.image, 'test-image');
});

test('compile is a start-only option and help explains it', async () => {
  const help = await execute(process.execPath, [join(ROOT, 'crossfire'), '--help']);
  assert.match(help.stdout, /start CONFIG_OR_INSTANCE \[--compile\]/);
  for (const command of ['info', 'onboarding', 'status', 'logs', 'stop', 'build', 'init', 'install-client', 'export-client']) {
    await assert.rejects(execute(process.execPath, [join(ROOT, 'crossfire'), command, '--compile']), /Unsupported option/);
  }
});

test('checked-in launcher resolves its own checkout and forwards the config path and compile flag', { skip: process.platform === 'win32' }, async context => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-launcher-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const binaries = join(directory, 'bin'); mkdirSync(binaries);
  writeFileSync(join(binaries, 'node'), `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  const config = join(directory, 'an instance', 'config with spaces.json');
  const result = await execute(join(ROOT, 'start.sh'), [config, '--compile'], { cwd: directory,
    env: { ...process.env, PATH: binaries + ':' + process.env.PATH, CROSSFIRE_REPO: '/must-not-be-used' } });
  assert.deepEqual(JSON.parse(result.stdout), [join(ROOT, 'crossfire'), 'start', config, '--compile']);
  await assert.rejects(execute(join(ROOT, 'start.sh'), [], { cwd: directory }), /Usage:.*CONFIG_FILE \[--compile\]/);
});
