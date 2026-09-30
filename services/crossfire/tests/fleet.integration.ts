import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value } from './support/application.js';
import { nativeProvider } from '../scripts/test-support/native-provider.js';
import { openTerminal } from '../scripts/test-support/terminal.js';
import { decideEnrollment } from '@crossfire/domain/enrollment/decide';
import { changeRoomGrant } from '@crossfire/domain/room-access/change-grant';
import { setRoomPermission } from '@crossfire/domain/room-access/set-permission';
import { roomAccess } from '@crossfire/adapter-crossfire/room-access';
import { createClient } from '@crossfire/adapter-crossfire/client';
import { operations } from '@crossfire/contracts/rest/operations';
import { API, segment } from '@crossfire/contracts/matrix';
import { nativeOk } from '@crossfire/adapter-matrix/http';

const execute = promisify(execFile);
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 30000;
  while (!predicate()) { assert(Date.now() < deadline, 'Native integration observation timed out'); await delay(30); }
}
type Fleet = { fleetId: string; phase: string; instances: { instance: { key: string }; phase: string; sessionId: string | null }[] };
type Binding = { fleetId: string; controllerCredential: string; identities: { instanceKey: string; agentId: string; account: { user_id: string; access_token: string } }[] };

test('real fleet CLI, daemon, Conduit and stock Codex enroll, deliver and resume without model housekeeping', { timeout: 180000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture()), { services, admin, origin, worker } = fixture;
  const directory = mkdtempSync(join(tmpdir(), 'native-fleet-')), root = join(directory, 'controller'), fleet = join(directory, 'fleet');
  const cliPath = resolve('../fleet/dist/apps/cli/src/main.js');
  const home = join(directory, 'home'); mkdirSync(home, { mode: 0o700 });
  const env = { ...process.env, HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: join(directory, 'config') };
  const cli = (...args: string[]) => execute(process.execPath, [cliPath, ...args], { env, timeout: 60000 });
  const definition = join(fleet, 'agents/analyst'); mkdirSync(definition, { recursive: true, mode: 0o700 });
  writeFileSync(join(definition, 'agent.toml'), 'name = "Research analyst"\nruntime = "codex"\n[runtime_options]\nmodel = "gpt-5.2"\nmodel_reasoning_effort = "high"\nsandbox_mode = "read-only"\napproval_policy = "never"\n', { mode: 0o600 });
  writeFileSync(join(definition, 'AGENTS.md'), 'Inert research fixture. Never contact an external provider.', { mode: 0o600 });
  const keys = ['north', 'south'];
  const providers: Awaited<ReturnType<typeof nativeProvider>>[] = [];
  for (const key of keys) {
    const nativeHome = join(definition, 'workarea', key, '.codex'); mkdirSync(nativeHome, { recursive: true, mode: 0o700 });
    writeFileSync(join(nativeHome, 'auth.json'), '{}', { mode: 0o600 });
    providers.push(await nativeProvider(scope, nativeHome));
  }
  writeFileSync(join(fleet, 'runtime.toml'), 'fleet = "research"\n[coordination]\nadapter = "crossfire"\nserver = ' + JSON.stringify(origin)
    + '\nowner = ' + JSON.stringify(admin.member.principal.matrixUserId) + '\n' + keys.map(key => '\n[[instances]]\nkey = "' + key + '"\nname = "' + key
      + '"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/' + key + '"\n').join(''), { mode: 0o600 });
  await cli('daemon', 'start', '--root', root, '--name', 'native-controller');
  scope.after(async () => { await cli('daemon', 'stop').catch(() => {}); });
  await cli('add', fleet);
  const starter = spawn(process.execPath, [cliPath, 'start', 'research'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = ''; starter.stdout.on('data', chunk => { output += String(chunk); }); starter.stderr.on('data', chunk => { errors += String(chunk); });
  const ended = once(starter, 'close'); scope.after(async () => { starter.kill('SIGTERM'); await ended; });
  await until(() => output.includes('awaiting-approval'));
  assert(providers.every(provider => provider.requests.length === 0));
  const requests = value(services.collection.enrollments({ ownerId: admin.actor.principalId, page: 1, pageSize: 100 })).items;
  assert.equal(requests.length, 1);
  const enrollment = requests[0]!;
  value(decideEnrollment(services, admin.actor, enrollment.id, { expectedRevision: enrollment.revision, decision: 'approve', verificationCode: enrollment.verificationCode }, randomUUID()));
  await worker.drain();
  const [code] = await ended; assert.equal(code, 0, output + errors);
  const first = JSON.parse((await cli('show', 'research')).stdout) as Fleet;
  assert.equal(first.phase, 'running'); assert(first.instances.every(instance => instance.phase === 'running' && instance.sessionId));
  assert(providers.every(provider => provider.requests.length === 0), 'Enrollment, native startup, release installation and ready heartbeats are model-free');
  const binding = JSON.parse(readFileSync(join(fleet, '.fleet/binding.json'), 'utf8')) as Binding;
  const controller = createClient({ origin, token: binding.controllerCredential });
  const view = value(await controller.call(operations.fleet, { fleetId: binding.fleetId }, {})).data;
  assert.equal(view.controller.name, 'native-controller');
  assert.equal(value(await controller.call(operations.fleetAgents, { fleetId: binding.fleetId }, {})).data.length, 2);
  const north = binding.identities.find(identity => identity.instanceKey === 'north')!;
  assert.equal((await controller.call(operations.changeWakePolicy, { agentId: north.agentId }, { expectedRevision: 0, mode: 'nobody', senderIds: [] })).ok, false);
  assert.equal((await controller.call(operations.fleet, { fleetId: randomUUID() }, {})).ok, false);
  const ownerNative = { base: fixture.native.base, token: admin.token };
  const created = value(await nativeOk(ownerNative, 'POST', API + '/createRoom', { name: 'Native fleet room', preset: 'private_chat',
    power_level_content_override: { invite: 0 } }));
  const roomId = created.room_id as string;
  const roomPath = API + '/rooms/' + segment(roomId);
  value(await changeRoomGrant(services, admin.actor, { agentId: north.agentId, roomId, expectedRevision: value(services.directory.agent(north.agentId))!.principal.revision,
    expectedGeneration: null, accessMode: 'reply', powerLevel: null, muted: false }, randomUUID()));
  await worker.drain();
  const grant = value(services.repositories.agentRoomGrant.find({ agentId: north.agentId, roomId }))!;
  value(setRoomPermission(services, admin.actor, { agentId: north.agentId, roomId, expectedRevision: value(services.directory.agent(north.agentId))!.principal.revision,
    expectedGeneration: grant.generation, permissions: ['room.agent.invite'] }, randomUUID()));
  const other = await fixture.member('other'), guest = await fixture.agent(other.actor, 'guest');
  const invitations = roomAccess({ origin, token: north.account.access_token });
  value(await invitations.change(guest.id, roomId, { accessMode: 'reply', powerLevel: null })); await worker.drain();
  assert.deepEqual(value(await nativeOk({ base: fixture.native.base, token: guest.token }, 'GET', API + '/joined_rooms')).joined_rooms, [roomId]);
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: guest.id, roomId }))!.addedById, north.agentId);
  value(await invitations.change(guest.id, roomId, null)); await worker.drain();
  assert.deepEqual(value(await nativeOk({ base: fixture.native.base, token: guest.token }, 'GET', API + '/joined_rooms')).joined_rooms, []);
  await cli('stop', 'research');
  writeFileSync(join(definition, 'agent.toml'), 'name = "Research analyst"\nruntime = "codex"\n[runtime_options]\nmodel = "gpt-5.1"\nmodel_reasoning_effort = "medium"\nsandbox_mode = "danger-full-access"\napproval_policy = "never"\n', { mode: 0o600 });
  await cli('start', 'research');
  const resumed = JSON.parse((await cli('show', 'research')).stdout) as Fleet;
  assert.deepEqual(resumed.instances.map(instance => instance.sessionId), first.instances.map(instance => instance.sessionId));
  assert(providers.every(provider => provider.requests.length === 0));
  const pointer = (await cli('agent', 'attach', 'research', 'north')).stdout.trim();
  assert(pointer.includes(first.instances[0]!.sessionId!));
  const northHome = join(definition, 'workarea/north/.codex');
  const terminal = openTerminal(scope, pointer, { ...env, CODEX_HOME: northHome });
  await terminal.until(output => output.includes('Folder access'));
  terminal.write('\r');
  await terminal.until(output => output.includes('gpt-5.1'));
  await terminal.quit();
  assert(providers.every(provider => provider.requests.length === 0), 'TUI pointer and native attachment make no model calls');
  assert((JSON.parse((await cli('show', 'research')).stdout) as Fleet).instances.every(instance => instance.phase === 'running'));
  const outsider = await fixture.native.register('visitor');
  value(await nativeOk(ownerNative, 'POST', roomPath + '/invite', { user_id: outsider.id }));
  value(await nativeOk({ base: fixture.native.base, token: outsider.token }, 'POST', roomPath + '/join', {}));
  value(await nativeOk({ base: fixture.native.base, token: outsider.token }, 'PUT', roomPath + '/send/m.room.message/context', { msgtype: 'm.text', body: 'Context from visitor' }));
  await delay(1400); assert(providers.every(provider => provider.requests.length === 0));
  value(await nativeOk(ownerNative, 'PUT', roomPath + '/send/m.room.message/task', { msgtype: 'm.text', body: 'Authorized owner task' }));
  await until(() => providers[0]!.requests.length === 1);
  const request = providers[0]!.requests[0] as { model: string; reasoning: { effort: string } };
  assert.equal(request.model, 'gpt-5.1'); assert.equal(request.reasoning.effort, 'medium');
  assert(JSON.stringify(request).includes('Context from visitor')); assert(JSON.stringify(request).includes('Authorized owner task'));
  assert.equal(providers[1]!.requests.length, 0); providers[0]!.finish();
  await delay(300);
  const outside = join(directory, 'full-access.txt');
  providers[0]!.tool('exec_command', { cmd: 'printf fleet-full-access-confirmed > ' + JSON.stringify(outside), yield_time_ms: 1000, max_output_tokens: 1024 });
  value(await nativeOk(ownerNative, 'PUT', roomPath + '/send/m.room.message/full-access', { msgtype: 'm.text', body: 'Inert full-access verification' }));
  await until(() => { try { return readFileSync(outside, 'utf8') === 'fleet-full-access-confirmed'; } catch { return false; } });
  await until(() => providers[0]!.requests.length === 3);
  await delay(300);
  const delivered = providers[0]!.requests.length;
  await cli('stop', 'research'); await cli('start', 'research');
  await delay(1400);
  assert.equal(providers[0]!.requests.length, delivered, 'Restart does not duplicate an acknowledged room input');
  assert.equal(value(services.directory.activeAgentCount()), 3, 'Restarts preserve the two fleet identities and the invited guest');
  await cli('daemon', 'stop');
});
