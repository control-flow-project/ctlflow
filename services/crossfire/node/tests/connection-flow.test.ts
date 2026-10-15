import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { readProfile } from '@ctlflow/crossfire-adapter-filesystem/project';
import { listenerStatus } from '@ctlflow/crossfire-adapter-crossfire/listener-protocol';
import { onboardingCommand, onboardingUrl, setupDescriptorUrl } from '@ctlflow/crossfire-contracts/onboarding';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { fleetView } from '@ctlflow/fleetd-contracts/api';
import { nativeServer } from './support/native-server.js';
import { value } from './support/application.js';
import { ownerSession } from './support/owner-session.js';
import { installedFleet } from './support/public-fleet.js';
import { nativeEngine, materialize } from '../scripts/test-support/native-engine.js';
import { until } from '../scripts/test-support/listener.js';
import { builtRelease } from '../scripts/test-support/release.js';

const execute = promisify(execFile);

test('public fleet setup starts a separate native history, reuses identity and preserves explicit stop intent', { timeout: 180_000 }, async scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/universal-setup-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'), project = join(directory, 'project');
  const root = mkdtempSync(join(tmpdir(), 'fc-'));
  cleanup(scope, () => rmSync(root, { recursive: true, force: true }));
  mkdirSync(home, { mode: 0o700 }); mkdirSync(project, { mode: 0o700 });
  execFileSync('git', ['init', '--quiet', project]);
  const release = builtRelease().release, fixture = await nativeServer(scope, release);
  const provider = await nativeProvider(scope, home);
  const existing = await nativeEngine(scope, home, project, ['-c', 'sandbox_mode="danger-full-access"']);
  await materialize(existing, provider);
  const originalConfiguration = readFileSync(join(home, 'config.toml'));
  const originalHistory = existing.session;
  const { services, origin, worker, admin } = fixture;
  const environment = { ...process.env, HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: join(directory, 'configuration'),
    CODEX_THREAD_ID: existing.session, RUNCODEX_CONNECTION_FILE: join(home, 'connection.json') };
  const executable = await installedFleet(scope);
  const cli = (...args: string[]) => execute(process.execPath, [executable, '--root', root, ...args], {
    cwd: project, env: environment, timeout: 70_000, maxBuffer: 256 * 1024,
  });
  cleanup(scope, async () => {
    if (existsSync(join(root, 'fleetd.sock'))) await cli('daemon', 'stop');
    await until(() => !existsSync(join(root, 'fleetd.sock')));
  });
  const guide = await fetch(onboardingUrl(origin, admin.member.principal.matrixUserId));
  assert.equal(guide.status, 200);
  const commands = [...(await guide.text()).matchAll(/```bash\n([\s\S]*?)\n```/gu)];
  assert.equal(commands.length, 1, 'There is one public npm setup command, not HTTP and native attachment alternatives');
  assert.equal(commands[0]![1], onboardingCommand(origin, admin.member.principal.matrixUserId, release.manifest));
  const starter = spawn(process.execPath, [executable, 'setup', '--root', root,
    '--descriptor', setupDescriptorUrl(origin, admin.member.principal.matrixUserId)], {
    cwd: project, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', errors = '';
  starter.stdout.on('data', bytes => { output += String(bytes); });
  starter.stderr.on('data', bytes => { errors = (errors + String(bytes)).slice(-64_000); });
  const ended = once(starter, 'close');
  cleanup(scope, async () => { starter.kill('SIGTERM'); await ended; });
  const observation = new AbortController();
  const signal = AbortSignal.any([scope.signal, observation.signal, AbortSignal.timeout(70_000)]);
  const promptedAt = performance.now();
  try {
    while (!output.includes('awaiting-approval') && starter.exitCode === null && starter.signalCode === null) {
      await Promise.race([once(starter.stdout, 'data', { signal }), ended]);
    }
  } catch (error) {
    scope.diagnostic('Setup output: ' + output + '\nSetup errors: ' + errors);
    throw error;
  } finally { observation.abort(); }
  scope.diagnostic('Enrollment prompt readiness: ' + Math.round(performance.now() - promptedAt) + 'ms');
  assert.equal(starter.exitCode, null, errors);
  assert.equal(starter.signalCode, null, errors);
  assert.equal(provider.requests.length, 0, 'Prerequisites, controller startup and enrollment make no model calls');
  const requests = value(services.collection.enrollments({ ownerId: admin.actor.principalId, page: 1, pageSize: 100 })).items;
  assert.equal(requests.length, 1);
  const request = requests[0]!;
  assert(output.includes(origin + '/manage/enrollments/' + request.id));
  assert(output.includes(request.verificationCode));
  const owner = await ownerSession(origin, admin.token);
  value(await owner.call(operations.decideEnrollment, { enrollmentId: request.id }, {
    expectedRevision: request.revision, decision: 'approve', verificationCode: request.verificationCode,
  }));
  await worker.drain();
  const [exitCode] = await ended;
  assert.equal(exitCode, 0, errors + output);
  assert(output.includes('"status": "ready"'));
  assert(!output.includes(existing.token));
  assert.equal(provider.requests.length, 0, 'Native startup and exact receiver readiness use ordinary code');
  const first = value(fleetView(JSON.parse((await cli('show', request.fleetKey!)).stdout)));
  assert.equal(first.phase, 'running');
  assert.equal(first.instances.length, 1);
  const agent = first.instances[0]!;
  assert(agent.sessionId);
  assert.notEqual(agent.sessionId, originalHistory, 'Setup never adopts the conversation that ran the command');
  const privateState = join(first.directory, agent.instance.workarea);
  const name = agent.instance.name;
  const profilePath = join(privateState, '.crossfire/profiles/' + name + '.json');
  const profileBytes = readFileSync(profilePath);
  const profile = readProfile(profilePath);
  assert.equal(profile.workspace, privateState);
  assert.equal(agent.instance.workspace, project);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: profile.id })), null);
  assert.deepEqual(value(services.collection.roomGrants({ agentId: profile.id })), []);
  const client = join(privateState, '.crossfire/client.mjs');
  const check = await execute(process.execPath, [client, '--project', privateState, '--profile', name, 'agent', 'test'], {
    cwd: project, env: environment, timeout: 45_000,
  });
  const checked = JSON.parse(check.stdout) as { status: string; listener: unknown };
  assert.equal(checked.status, 'passed');
  const ready = value(listenerStatus(checked.listener, 'test'));
  assert.equal(ready.ready, true);
  assert.equal(ready.test?.authenticated, true);
  assert.equal(ready.session, agent.sessionId);
  assert.equal(ready.test?.rooms, 0);
  assert.equal(ready.test?.deliveryPaused, false);
  assert.equal(ready.test?.busy, false);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: profile.id })), null);
  const controllerStatus = (await cli('daemon', 'status')).stdout;
  const repeated = await cli('setup');
  assert(repeated.stdout.includes('"status": "ready"'));
  assert.equal((await cli('daemon', 'status')).stdout, controllerStatus, 'Repeated setup reuses the same controller lifetime');
  assert.equal(value(fleetView(JSON.parse((await cli('show', first.fleetKey)).stdout))).instances[0]!.sessionId, agent.sessionId);
  assert.deepEqual(readFileSync(profilePath), profileBytes);
  assert.equal(value(services.directory.agentIds(admin.actor.principalId)).length, 1);
  assert.equal(provider.requests.length, 0);
  assert.equal(existsSync(join(project, '.crossfire')), false, 'Private fleet state never alters the existing native project');
  assert.equal(existsSync(join(project, '.codex')), false);
  assert.equal(existsSync(join(project, '.gitignore')), false);
  assert.deepEqual(readFileSync(join(home, 'config.toml')), originalConfiguration);
  assert.equal(existing.child.exitCode, null);
  await cli('stop', first.fleetKey);
  const stopped = value(fleetView(JSON.parse((await cli('show', first.fleetKey)).stdout)));
  assert(stopped.instances.every(instance => instance.phase === 'stopped' && !instance.desiredActive && !instance.listenerActive));
  const stoppedRepeat = await cli('setup');
  assert(stoppedRepeat.stdout.includes('"status": "stopped"'), 'Setup never reverses explicit stop intent');
  assert.equal(value(fleetView(JSON.parse((await cli('show', first.fleetKey)).stdout))).instances[0]!.phase, 'stopped');
  await cli('start', first.fleetKey);
  const resumed = value(fleetView(JSON.parse((await cli('show', first.fleetKey)).stdout)));
  assert.equal(resumed.instances[0]!.phase, 'running');
  assert.equal(resumed.instances[0]!.sessionId, agent.sessionId, 'Default start resumes the exact managed native history');
  assert.deepEqual(readFileSync(profilePath), profileBytes);
  assert.equal(provider.requests.length, 0);
  assert.equal(existing.child.exitCode, null);
  await cli('stop', first.fleetKey);
  const preservedHistory = readFileSync(join(privateState, '.codex/crossfire-context-registry.json'));
  await cli('remove', first.fleetKey);
  const archived = value(services.repositories.fleet.find({ ownerId: admin.actor.principalId, fleetKey: first.fleetKey }));
  assert(archived?.archivedAt !== null && archived?.archivedAt !== undefined, 'CLI removal archives through the same receipt-gated domain operation as management');
  assert.deepEqual(readFileSync(profilePath), profileBytes);
  assert.deepEqual(readFileSync(join(privateState, '.codex/crossfire-context-registry.json')), preservedHistory);
  assert.equal(value(services.directory.agentIds(admin.actor.principalId)).length, 1, 'Archival retains the enrolled identity');
  await assert.rejects(cli('setup'), 'Repeated setup cannot reactivate an archived fleet');
  assert.equal(provider.requests.length, 0);
  assert.equal(existing.child.exitCode, null);
});
