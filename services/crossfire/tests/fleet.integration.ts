import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { trustWorkspace } from '@ctlflow/crossfire-test-support/codex';
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value } from './support/application.js';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { openTerminal } from '../scripts/test-support/terminal.js';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { changeRoomGrant } from '@ctlflow/crossfire-domain/room-access/change-grant';
import { roomAccess } from '@ctlflow/crossfire-adapter-crossfire/room-access';
import { createClient } from '@ctlflow/crossfire-adapter-crossfire/client';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { runtimeOperation, type FleetRuntimeOperation } from '@ctlflow/crossfire-contracts/fleet-runtime';
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import { nativeOk } from '@ctlflow/crossfire-adapter-matrix/http';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';

const execute = promisify(execFile);
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 30000;
  while (!predicate()) { assert(Date.now() < deadline, 'Native integration observation timed out'); await delay(30); }
}
type Fleet = { fleetId: string; phase: string; connection: { connected: boolean; deliveryEnabled: boolean; revision: number | null }; instances: { instance: { key: string }; phase: string; sessionId: string | null; listenerActive: boolean }[] };
type Binding = { fleetId: string; controllerCredential: string; identities: { instanceKey: string; agentId: string; account: { user_id: string; access_token: string } }[] };

test('real fleet CLI, daemon, Conduit and stock Codex enroll, deliver and resume without model housekeeping', { timeout: 180000 }, async scope => {
  const fixture = await nativeServer(scope, await releaseFixture()), { services, admin, origin, worker } = fixture;
  const directory = mkdtempSync(join(tmpdir(), 'native-fleet-')), root = join(directory, 'controller'), fleet = join(directory, 'fleet');
  const cliPath = resolve('../fleet/dist/apps/cli/src/main.js');
  const home = join(directory, 'home'); mkdirSync(home, { mode: 0o700 });
  const env = { ...process.env, HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: join(directory, 'config') };
  const cli = (...args: string[]) => execute(process.execPath, [cliPath, ...args], { env, timeout: 60000 });
  const definition = join(fleet, 'agents/analyst'); mkdirSync(definition, { recursive: true, mode: 0o700 });
  const coordinationOptions = '\n[coordination_options]\nwake_mode = "owner-agents"\npermissions = ["room.agent.invite"]\n';
  writeFileSync(join(definition, 'agent.toml'), 'name = "Research analyst"\nruntime = "codex"\n[runtime_options]\nmodel = "gpt-5.2"\nmodel_reasoning_effort = "high"\nsandbox_mode = "read-only"\napproval_policy = "never"\n' + coordinationOptions, { mode: 0o600 });
  writeFileSync(join(definition, 'AGENTS.md'), 'Inert research fixture. Never contact an external provider.', { mode: 0o600 });
  const keys = ['north', 'south'];
  const providers: Awaited<ReturnType<typeof nativeProvider>>[] = [];
  for (const key of keys) {
    const nativeHome = join(definition, 'workarea', key, '.codex'); mkdirSync(nativeHome, { recursive: true, mode: 0o700 });
    writeFileSync(join(nativeHome, 'auth.json'), '{}', { mode: 0o600 });
    providers.push(await nativeProvider(scope, nativeHome));
    trustWorkspace(nativeHome, join(definition, 'workarea', key));
  }
  writeFileSync(join(fleet, 'runtime.toml'), 'fleet = "research"\n[coordination]\nadapter = "crossfire"\nserver = ' + JSON.stringify(origin)
    + '\nowner = ' + JSON.stringify(admin.member.principal.matrixUserId) + '\n' + keys.map(key => '\n[[instances]]\nkey = "' + key + '"\nname = "' + key
      + '"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/' + key + '"\n').join(''), { mode: 0o600 });
  await cli('daemon', 'start', '--root', root, '--name', 'native-controller');
  cleanup(scope, async () => { await cli('daemon', 'stop').catch(() => {}); });
  await cli('add', fleet);
  const starter = spawn(process.execPath, [cliPath, 'start', 'research'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = ''; starter.stdout.on('data', chunk => { output += String(chunk); }); starter.stderr.on('data', chunk => { errors += String(chunk); });
  const ended = once(starter, 'close'); cleanup(scope, async () => { starter.kill('SIGTERM'); await ended; });
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
  const cursor = join(definition, 'workarea/north/.crossfire/state/north/cursors.json.sync');
  const journal = join(definition, 'workarea/north/.codex/crossfire-session.json.receipt');
  async function acquired() {
    const snapshot = value(await nativeOk({ base: fixture.native.base, token: north.account.access_token }, 'GET', API + '/sync?timeout=0'));
    assert.equal(typeof snapshot.next_batch, 'string');
    await until(() => existsSync(cursor) && readJson<string>(cursor) === snapshot.next_batch);
  }
  async function acknowledged() {
    await until(() => {
      if (!existsSync(journal)) return false;
      const state = readJson<{ pending: unknown; confirmed: unknown[] }>(journal);
      return state.pending === null && state.confirmed.length === 0;
    });
  }
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
  assert.deepEqual(value(services.collection.roomPermissions({ agentId: north.agentId, roomId })).map(permission => permission.permissionCode), ['room.agent.invite']);
  const other = await fixture.member('other'), guest = await fixture.agent(other.actor, 'guest');
  const invitations = roomAccess({ origin, token: north.account.access_token });
  value(await invitations.change(guest.id, roomId, { accessMode: 'reply', powerLevel: null })); await worker.drain();
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: guest.id })), null);
  assert.deepEqual(value(await nativeOk({ base: fixture.native.base, token: guest.token }, 'GET', API + '/joined_rooms')).joined_rooms, [roomId]);
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: guest.id, roomId }))!.addedById, north.agentId);
  value(await invitations.change(guest.id, roomId, null)); await worker.drain();
  assert.deepEqual(value(await nativeOk({ base: fixture.native.base, token: guest.token }, 'GET', API + '/joined_rooms')).joined_rooms, []);
  await cli('stop', 'research');
  writeFileSync(join(definition, 'agent.toml'), 'name = "Research analyst"\nruntime = "codex"\n[runtime_options]\nmodel = "gpt-5.1"\nmodel_reasoning_effort = "medium"\nsandbox_mode = "danger-full-access"\napproval_policy = "never"\n' + coordinationOptions, { mode: 0o600 });
  await cli('start', 'research');
  const resumed = JSON.parse((await cli('show', 'research')).stdout) as Fleet;
  assert.deepEqual(resumed.instances.map(instance => instance.sessionId), first.instances.map(instance => instance.sessionId));
  assert(providers.every(provider => provider.requests.length === 0));
  const pointer = (await cli('agent', 'attach', 'research', 'north')).stdout.trim();
  assert(pointer.includes(first.instances[0]!.sessionId!));
  const northHome = join(definition, 'workarea/north/.codex');
  const terminal = openTerminal(scope, pointer, { ...env, CODEX_HOME: northHome });
  await terminal.until(output => output.includes('gpt-5.1'));
  await terminal.quit();
  assert(providers.every(provider => provider.requests.length === 0), 'TUI pointer and native attachment make no model calls');
  assert((JSON.parse((await cli('show', 'research')).stdout) as Fleet).instances.every(instance => instance.phase === 'running'));
  value(await invitations.change(guest.id, roomId, { accessMode: 'reply', powerLevel: null })); await worker.drain();
  value(await nativeOk({ base: fixture.native.base, token: guest.token }, 'PUT', roomPath + '/send/m.room.message/foreign-context',
    { msgtype: 'm.text', body: 'Context from another owner’s agent' }));
  value(await nativeOk(ownerNative, 'POST', roomPath + '/invite', { user_id: other.member.principal.matrixUserId }));
  value(await nativeOk({ base: fixture.native.base, token: other.token }, 'POST', roomPath + '/join', {}));
  value(await nativeOk({ base: fixture.native.base, token: other.token }, 'PUT', roomPath + '/send/m.room.message/human-context',
    { msgtype: 'm.text', body: 'Context from another registered human' }));
  const outsider = await fixture.native.register('visitor');
  value(await nativeOk(ownerNative, 'POST', roomPath + '/invite', { user_id: outsider.id }));
  value(await nativeOk({ base: fixture.native.base, token: outsider.token }, 'POST', roomPath + '/join', {}));
  value(await nativeOk({ base: fixture.native.base, token: outsider.token }, 'PUT', roomPath + '/send/m.room.message/context', { msgtype: 'm.text', body: 'Context from visitor' }));
  await acquired(); assert(providers.every(provider => provider.requests.length === 0));
  value(await nativeOk(ownerNative, 'PUT', roomPath + '/send/m.room.message/task', { msgtype: 'm.text', body: 'Authorized owner task' }));
  await until(() => providers[0]!.requests.length === 1);
  const request = providers[0]!.requests[0] as { model: string; reasoning: { effort: string };
    input: { type: string; role?: string; content?: { type: string; text?: string }[] }[] };
  assert.equal(request.model, 'gpt-5.1'); assert.equal(request.reasoning.effort, 'medium');
  assert(JSON.stringify(request).includes('Context from visitor')); assert(JSON.stringify(request).includes('Authorized owner task'));
  const input = request.input.filter(item => item.type === 'message' && item.role === 'user')
    .flatMap(item => item.content ?? []).find(item => item.text?.startsWith('Crossfire messages from the selected coordination instance.'))?.text;
  assert(input, 'The actual native provider request contains the listener envelope');
  const deliveredContext = JSON.parse(input.slice(input.indexOf('\n') + 1)) as { owner: string;
    senders: Record<string, { kind: 'human' | 'agent' | 'unknown'; owner?: string }> };
  assert.equal(deliveredContext.owner, admin.member.principal.matrixUserId);
  assert.deepEqual(deliveredContext.senders[admin.member.principal.matrixUserId], { kind: 'human', display_name: 'admin', relationship: 'owner' });
  assert.deepEqual(deliveredContext.senders[other.member.principal.matrixUserId], { kind: 'human', display_name: 'other', relationship: 'other-human' });
  assert.deepEqual(deliveredContext.senders[guest.matrixUserId], { kind: 'agent', owner: other.member.principal.matrixUserId, display_name: 'guest (other)', owner_display_name: 'other', relationship: 'other-owners-agent' });
  assert.deepEqual(deliveredContext.senders[outsider.id], { kind: 'unknown', display_name: null, relationship: 'unknown' });
  assert(!input.includes(north.account.access_token) && !input.includes(guest.token));
  assert.equal(providers[1]!.requests.length, 0); providers[0]!.finish();
  await acknowledged();
  const outside = join(directory, 'full-access.txt');
  providers[0]!.tool('exec_command', { cmd: 'printf fleet-full-access-confirmed > ' + JSON.stringify(outside), yield_time_ms: 1000, max_output_tokens: 1024 });
  value(await nativeOk(ownerNative, 'PUT', roomPath + '/send/m.room.message/full-access', { msgtype: 'm.text', body: 'Inert full-access verification' }));
  await until(() => { try { return readFileSync(outside, 'utf8') === 'fleet-full-access-confirmed'; } catch { return false; } });
  await until(() => providers[0]!.requests.length === 3);
  await acknowledged();
  const delivered = providers[0]!.requests.length;
  await cli('stop', 'research'); await cli('start', 'research');
  await acquired(); await acknowledged();
  assert.equal(providers[0]!.requests.length, delivered, 'Restart does not duplicate an acknowledged room input');
  assert.equal(value(services.directory.activeAgentCount()), 3, 'Restarts preserve the two fleet identities and the invited guest');
  const sessions = (JSON.parse((await cli('show', 'research')).stdout) as Fleet).instances.map(instance => instance.sessionId);
  async function ownerCall(path: string, body: unknown) {
    const response = await fetch(origin + path, { method: 'PUT', headers: { Cookie: '__Host-crossfire=' + admin.secret, Origin: origin,
      'X-Crossfire-CSRF': admin.csrfSecret, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, await response.text());
  }
  const remoteFleet = () => value(services.repositories.fleet.findById(binding.fleetId))!;
  await ownerCall('/api/fleets/' + binding.fleetId + '/delivery', { expectedRevision: remoteFleet().revision, enabled: false });
  async function observe(predicate: (fleet: Fleet) => boolean) {
    const deadline = Date.now() + 30000;
    for (;;) {
      const current = JSON.parse((await cli('show', 'research')).stdout) as Fleet;
      if (predicate(current)) return current;
      assert(Date.now() < deadline, JSON.stringify(current)); await delay(100);
    }
  }
  const paused = await observe(current => current.instances.every(instance => !instance.listenerActive));
  assert.equal(paused.phase, 'running'); assert.deepEqual(paused.instances.map(instance => instance.sessionId), sessions);
  const beforePause = providers.map(provider => provider.requests.length);
  value(await nativeOk(ownerNative, 'PUT', roomPath + '/send/m.room.message/while-disabled', { msgtype: 'm.text', body: 'Retained while fleet is deactivated' }));
  await assert.rejects(cli('message', 'research', '--text', 'Refused while deactivated'), /Activate this fleet/);
  assert.deepEqual(providers.map(provider => provider.requests.length), beforePause);
  await cli('activate', 'research');
  await observe(current => current.instances.every(instance => instance.listenerActive));
  await until(() => providers[0]!.requests.length === beforePause[0]! + 1);
  assert(JSON.stringify(providers[0]!.requests.at(-1)).includes('Retained while fleet is deactivated'));
  const messageId = randomUUID();
  await cli('message', 'research', '--text', 'Explicit controller task to the whole fleet', '--message-id', messageId);
  await until(() => providers[1]!.requests.length === 1);
  await until(() => value(services.repositories.fleetMessageDelivery.forMessages([messageId])).every(delivery => delivery.status === 'delivered'));
  assert(providers.every(provider => JSON.stringify(provider.requests.at(-1)).includes('Explicit controller task to the whole fleet')));
  providers[1]!.finish();
  const beforeRepeat = providers.map(provider => provider.requests.length);
  await cli('message', 'research', '--text', 'Explicit controller task to the whole fleet', '--message-id', messageId);
  await acquired(); await acknowledged(); assert.deepEqual(providers.map(provider => provider.requests.length), beforeRepeat);
  const address = fixture.router.address(); assert(address && typeof address !== 'string');
  const originalLease = value(services.repositories.fleetConnection.find(binding.fleetId))!;
  fixture.router.closeAllConnections(); await new Promise<void>(resolve => fixture.router.close(() => resolve()));
  const disconnected = await observe(current => !current.connection.connected && current.instances.every(instance => !instance.listenerActive));
  assert.equal(disconnected.phase, 'running'); assert.deepEqual(disconnected.instances.map(instance => instance.sessionId), sessions);
  fixture.router.listen(address.port, '127.0.0.1'); await once(fixture.router, 'listening');
  await observe(current => current.connection.connected && current.instances.every(instance => instance.listenerActive));
  const reconnectedLease = value(services.repositories.fleetConnection.find(binding.fleetId))!;
  assert.notEqual(reconnectedLease.connectionId, originalLease.connectionId, 'Reconnection uses a fresh generation');
  assert(services.clock.now() < originalLease.expiresAt, 'The exact held lease is released before reconnecting, not left to expire');
  await acquired(); await acknowledged(); assert.deepEqual(providers.map(provider => provider.requests.length), beforeRepeat, 'Control reconnection makes no model calls or duplicate deliveries');
  await cli('deactivate', 'research'); await observe(current => current.instances.every(instance => !instance.listenerActive));
  await cli('activate', 'research'); await observe(current => current.instances.every(instance => instance.listenerActive));
  const sessionOperationsPath = '/api/fleets/' + binding.fleetId + '/session-operations';
  async function requestSessions(action: FleetRuntimeOperation['action'], agentId: string | null) {
    const input = { operationId: randomUUID(), action, agentId, expectedRevision: remoteFleet().revision, confirmFreshHistory: action === 'reset' };
    const response = await fetch(origin + sessionOperationsPath, { method: 'POST', headers: { Cookie: '__Host-crossfire=' + admin.secret, Origin: origin,
      'X-Crossfire-CSRF': admin.csrfSecret, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const body = await response.text(); assert.equal(response.status, 202, body);
    const accepted = value(runtimeOperation((JSON.parse(body) as { data: unknown }).data));
    assert.equal(accepted.operationId, input.operationId);
    await until(() => {
      const current = value(services.repositories.fleetRuntimeOperation.find(input.operationId));
      return current !== null && current.completedAt !== null;
    });
    const completed = value(services.repositories.fleetRuntimeOperation.find(input.operationId))!;
    assert.equal(completed.status, 'succeeded', completed.errorMessage ?? 'Native session operation failed');
    assert.equal(completed.action, action); assert.equal(completed.agentId, agentId);
    return input;
  }
  const beforeSessionControls = providers.map(provider => provider.requests.length);
  await requestSessions('stop', null);
  const remotelyStopped = await observe(current => current.phase === 'stopped' && current.connection.connected);
  assert(remotelyStopped.instances.every(instance => !instance.listenerActive));
  assert.deepEqual(remotelyStopped.instances.map(instance => instance.sessionId), sessions);
  await requestSessions('start', null);
  const remotelyResumed = await observe(current => current.instances.every(instance => instance.phase === 'running' && instance.listenerActive));
  assert.deepEqual(remotelyResumed.instances.map(instance => instance.sessionId), sessions, 'Remote fleet resume retains the exact native histories');
  await requestSessions('stop', north.agentId);
  const individualStopped = await observe(current => current.instances.find(instance => instance.instance.key === 'north')?.phase === 'stopped');
  assert.equal(individualStopped.connection.connected, true);
  assert.equal(individualStopped.instances.find(instance => instance.instance.key === 'south')?.phase, 'running');
  await requestSessions('start', north.agentId);
  const individualResumed = await observe(current => current.instances.every(instance => instance.phase === 'running' && instance.listenerActive));
  assert.deepEqual(individualResumed.instances.map(instance => instance.sessionId), sessions, 'Remote individual resume preserves both histories');
  await requestSessions('reset', north.agentId);
  const individualFresh = await observe(current => current.instances.every(instance => instance.phase === 'running' && instance.listenerActive));
  assert.notEqual(individualFresh.instances[0]!.sessionId, sessions[0]);
  assert.equal(individualFresh.instances[1]!.sessionId, sessions[1], 'Fresh individual history does not replace a peer history');
  const wholeFleetReset = await requestSessions('reset', null);
  const fleetFresh = await observe(current => current.instances.every(instance => instance.phase === 'running' && instance.listenerActive));
  assert(fleetFresh.instances.every((instance, index) => instance.sessionId !== individualFresh.instances[index]!.sessionId));
  const repeatedReset = await fetch(origin + sessionOperationsPath, { method: 'POST', headers: { Cookie: '__Host-crossfire=' + admin.secret, Origin: origin,
    'X-Crossfire-CSRF': admin.csrfSecret, 'Content-Type': 'application/json' }, body: JSON.stringify(wholeFleetReset) });
  assert.equal(repeatedReset.status, 202, await repeatedReset.text());
  const unchanged = JSON.parse((await cli('show', 'research')).stdout) as Fleet;
  assert.deepEqual(unchanged.instances.map(instance => instance.sessionId), fleetFresh.instances.map(instance => instance.sessionId), 'Retrying a confirmed reset cannot create another native history');
  const retainedBinding = JSON.parse(readFileSync(join(fleet, '.fleet/binding.json'), 'utf8')) as Binding;
  assert.deepEqual(retainedBinding, binding, 'Fresh history retains enrollment identities and credentials');
  assert.equal(value(services.repositories.agentRoomGrant.find({ agentId: north.agentId, roomId }))!.accessMode, 'reply');
  assert.deepEqual(value(services.collection.roomPermissions({ agentId: north.agentId, roomId })).map(permission => permission.permissionCode), ['room.agent.invite']);
  await acquired(); await acknowledged();
  assert.deepEqual(providers.map(provider => provider.requests.length), beforeSessionControls, 'Native remote session controls, resets and history exports are model-free');
  await cli('stop', 'research');
  await observe(current => current.phase === 'stopped' && current.connection.connected);
  const stoppedMessageId = randomUUID(), beforeStopped = providers.map(provider => provider.requests.length);
  await cli('message', 'research', '--text', 'Stopped recipients are not automatically started', '--message-id', stoppedMessageId);
  await until(() => value(services.repositories.fleetMessageDelivery.forMessages([stoppedMessageId])).every(delivery => delivery.status === 'skipped'));
  assert.deepEqual(providers.map(provider => provider.requests.length), beforeStopped);
  await cli('remove', 'research');
  assert.notEqual(value(services.repositories.fleetConnection.find(binding.fleetId))!.closedAt, null, 'Unregistering a stopped fleet closes its controller connection');
  await cli('daemon', 'stop');
});
