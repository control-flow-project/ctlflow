import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fakeCodex, matrixFixture, THREAD } from '../scripts/test-support/listener.js';
import { builtRelease, installTestRelease } from '../scripts/test-support/release.js';
import { updatedRelease } from './release-fixture.js';
import { updateNotice } from '../packages/contracts/src/release.js';
import { listen } from '../packages/agent-core/src/listen.js';
import { discoverCodex } from '../packages/adapter-codex/src/discovery.js';

const execute = promisify(execFile);

test('one connect installs, starts, reuses, upgrades and disconnects the existing identity without model calls', async scope => {
  const native = await fakeCodex(scope);
  const fixture = await matrixFixture(scope, native.directory);
  const client = installTestRelease(native.directory);
  const profile = join(fixture.workspace, '.crossfire/profiles/watson.json');
  const identity = readFileSync(profile);
  const args = [client, '--project', fixture.workspace, '--profile', 'watson'];
  const executeClient = (...command: string[]) => execute(process.execPath, [...args, ...command], { env: fixture.env, timeout: 30_000 });
  scope.after(async () => { await executeClient('agent', 'disconnect'); });
  for (const option of ['--session', '--endpoint', '--token-file', '--token-env']) {
    await assert.rejects(executeClient('agent', 'connect', option, 'not-a-connection'), /Unknown option|Unsupported option/);
  }
  await assert.rejects(executeClient('agent', 'enroll'), /Unknown agent command/);
  const first = await executeClient('agent', 'connect');
  const started = JSON.parse(first.stdout.slice(first.stdout.lastIndexOf('\n{\n') + 1)) as { status: string; listener: { ready: boolean } };
  assert.equal(started.status, 'listening');
  assert.equal(started.listener.ready, true);
  assert(first.stdout.includes('software-ready'));
  assert(first.stdout.includes('skill'));
  const record = readFileSync(join(fixture.workspace, '.crossfire/state/watson/listener.json'));
  const count = native.requests().filter(request => request.method === 'thread/resume').length;
  await Promise.all([executeClient('agent', 'connect'), executeClient('agent', 'connect')]);
  assert.deepEqual(readFileSync(join(fixture.workspace, '.crossfire/state/watson/listener.json')), record);
  assert.equal(native.requests().filter(request => request.method === 'thread/resume').length, count);
  const current = updatedRelease(builtRelease().release, 'SKILL.md', '# Updated fixture skill\n');
  fixture.publication.release = current;
  fixture.reporting.current = current.manifest;
  const upgraded = await executeClient('agent', 'connect');
  assert(upgraded.stdout.includes(current.manifest.release));
  assert(upgraded.stdout.includes('Updated fixture skill'));
  assert.notDeepEqual(readFileSync(join(fixture.workspace, '.crossfire/state/watson/listener.json')), record);
  assert.equal(native.requests().filter(request => request.method === 'thread/resume').length, count + 1);
  assert.deepEqual(readFileSync(profile), identity);
  assert(!fixture.requests.some(request => request.path.endsWith('/exchange') || request.path === '/_coord/enrollments'));
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  const stable = join(fixture.workspace, '.crossfire/client.mjs');
  const status = await execute(process.execPath, [stable, '--project', fixture.workspace, 'agent', 'status'], { env: fixture.env });
  assert.equal(JSON.parse(status.stdout).listener.release, current.manifest.release);
  const broken = updatedRelease(current, 'README.md', '# New guide\n');
  fixture.publication.release = { ...broken, files: { ...broken.files, 'README.md': Buffer.from('corrupt') } };
  fixture.reporting.current = broken.manifest;
  await assert.rejects(executeClient('agent', 'connect'), /verification|published size/);
  const preserved = await execute(process.execPath, [stable, '--project', fixture.workspace, 'agent', 'status'], { env: fixture.env });
  assert.equal(JSON.parse(preserved.stdout).listener.release, current.manifest.release);
  await executeClient('agent', 'disconnect');
  assert.equal(JSON.parse((await executeClient('agent', 'status')).stdout).listener, null);
  assert.deepEqual(readFileSync(profile), identity);
});

test('automatic discovery requires a private exact descriptor and native session, never guessed arguments', async scope => {
  const native = await fakeCodex(scope);
  const fixture = await matrixFixture(scope, native.directory);
  const discovered = discoverCodex(native.directory, fixture.env);
  assert.equal(discovered.session, THREAD);
  assert.throws(() => discoverCodex(native.directory, {}), /runcodex/);
  const descriptor = join(native.directory, 'connection.json');
  chmodSync(descriptor, 0o644);
  assert.throws(() => discoverCodex(native.directory, fixture.env), /private/);
  chmodSync(descriptor, 0o600);
  writeFileSync(descriptor, JSON.stringify({ version: 1, endpoint: 'ws://external.example:1234', tokenFile: 'token' }));
  assert.throws(() => discoverCodex(native.directory, fixture.env), /Invalid launcher/);
});

test('adapter admission stops before runtime attachment and unchanged skills do not require another read', async scope => {
  const native = await fakeCodex(scope);
  const fixture = await matrixFixture(scope, native.directory);
  const installed = builtRelease().release;
  const current = updatedRelease(installed, 'README.md', '# Updated instructions\n');
  fixture.reporting.current = current.manifest;
  const notice = updateNotice(fixture.settings.homeserver, installed.manifest.release, current.manifest, installed.manifest.artifacts['SKILL.md'].sha256);
  assert.match(notice, /skill content is unchanged/);
  await assert.rejects(listen({ ...fixture, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, new AbortController().signal), /Crossfire update required/);
  assert.equal(native.requests().length, 0);
});
