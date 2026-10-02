import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { connectCodex, type CodexConnection } from '@crossfire/adapter-codex/connection';
import { nativeEngine, materialize } from '../test-support/native-engine.js';
import { nativeProvider } from '../test-support/native-provider.js';
import { matrixFixture, message, temporary, until, ROOM, OWNER_DM, SELF, OBSERVER } from '../test-support/listener.js';
import { installTestRelease } from '../test-support/release.js';
import { prepareProject } from '@crossfire/adapter-filesystem/project';
import { privateDir } from '@crossfire/adapter-filesystem/index';
import { failure } from '@crossfire/kernel/result';

test('a real native permission is answered only by the verified Matrix owner through the single receiver', { timeout: 30_000 }, async scope => {
  const directory = temporary(scope);
  const home = join(directory, 'home'), workspace = join(directory, 'workspace');
  mkdirSync(home); mkdirSync(workspace);
  const provider = await nativeProvider(scope, home);
  const engine = await nativeEngine(scope, home, workspace, ['-c', 'approval_policy="on-request"', '-c', 'sandbox_mode="workspace-write"']);
  await materialize(engine, provider);
  const fixture = await matrixFixture(scope, workspace);
  const stop = new AbortController();
  let nativeRequest = false;
  let failure: unknown;
  const receiving = listen({ ...fixture, reconcileMs: 120_000, limit: 20, pollMs: 100, debounceMs: 0,
    runtime: (signal, pollMs, hooks) => connectCodex({ ...engine, pollMs, timeoutMs: 10_000,
      hooks: { requestPermission: (permission, cancelled) => {
        nativeRequest = true;
        assert.equal(permission.runtime, 'codex');
        assert(JSON.stringify(permission.scope).includes('printf native-approved'));
        return hooks.requestPermission(permission, cancelled);
      } },
    }, signal),
  }, stop.signal).catch(error => { failure = error; return error; });
  cleanup(scope, async () => {
    stop.abort(); await receiving;
  });
  await until(() => fixture.waiting() > 0);
  await engine.call('thread/unsubscribe', { threadId: engine.session });
  provider.tool('exec_command', { cmd: 'printf native-approved', sandbox_permissions: 'require_escalated',
    justification: 'May the isolated fixture print its approval marker?', max_output_tokens: 100, yield_time_ms: 1000 });
  fixture.add(ROOM, message('$native-permission-input', OBSERVER, 'Run the isolated permission fixture'));
  await until(() => nativeRequest || failure !== undefined, 'Native permission was not observed');
  assert.equal(failure, undefined, String(failure));
  await until(() => fixture.rooms.get(OWNER_DM)!.some(event => event.sender === SELF && String(event.content.body).includes('Permission needed')));
  const request = fixture.rooms.get(OWNER_DM)!.find(event => event.sender === SELF && String(event.content.body).includes('Permission needed'))!;
  const approval = { ...message('$native-owner-decision', OBSERVER, 'approve once'), content: { msgtype: 'm.text', body: 'approve once',
    'm.relates_to': { 'm.in_reply_to': { event_id: request.event_id } } } };
  fixture.add(OWNER_DM, { ...approval, event_id: '$native-outsider', sender: '@other:test.localhost' });
  assert.equal(provider.requests.some(request => JSON.stringify(request).includes('native-approved\n')), false);
  fixture.add(OWNER_DM, approval);
  await until(() => provider.requests.some(request => JSON.stringify(request).includes('native-approved')
    && JSON.stringify(request).includes('function_call_output')), 'Native permission decision did not complete the command');
  assert(existsSync(fixture.cursorFile));
  assert(provider.requests.every(request => !JSON.stringify(request).includes('$native-owner-decision')
    && !JSON.stringify(request).includes('$native-outsider')));
  stop.abort(new Error('Native permission proof complete'));
  assert.match(String(await receiving), /proof complete/);
});

for (const reason of ['forbidden', 'unavailable'] as const) {
  test('a native ' + reason + ' approval denies only its command and retains the exact runtime', { timeout: 30_000 }, async scope => {
    const directory = temporary(scope), home = join(directory, 'home'), workspace = join(directory, 'workspace');
    mkdirSync(home); mkdirSync(workspace);
    const provider = await nativeProvider(scope, home);
    const engine = await nativeEngine(scope, home, workspace, ['-c', 'approval_policy="on-request"', '-c', 'sandbox_mode="workspace-write"']);
    await materialize(engine, provider);
    const stop = new AbortController();
    let requests = 0;
    const runtime = await connectCodex({ ...engine, pollMs: 100, timeoutMs: 10_000,
      hooks: { requestPermission: async () => { requests++; return failure(reason, 'Fixture approval is not available'); } } }, stop.signal);
    cleanup(scope, async () => { stop.abort(); await runtime.close(); });
    await engine.call('thread/unsubscribe', { threadId: engine.session });
    const marker = join(workspace, 'unapproved-command');
    provider.tool('exec_command', { cmd: 'touch ' + JSON.stringify(marker), sandbox_permissions: 'require_escalated',
      justification: 'May this fixture create its exact marker?', yield_time_ms: 1000 });
    await runtime.deliver('Exercise the denied native command.', 'denied-native-' + reason, stop.signal);
    await until(async () => requests > 0 && !(await runtime.inspect()).busy, 'Denied native turn did not finish');
    assert.equal(requests, 1);
    assert.equal(existsSync(marker), false);
    assert.equal(runtime.signal.aborted, false);
    assert.equal(runtime.sessionId, engine.session);
    provider.hold();
    await runtime.deliver('This same session is still usable.', 'continued-native-' + reason, stop.signal);
    await until(() => !!provider.held(), 'Runtime did not accept the following input');
    assert.equal(runtime.signal.aborted, false);
    provider.finish();
    await until(async () => !(await runtime.inspect()).busy);
  });
}

test('a real native owner approval permits an intentional verified-client Matrix reply without disconnecting', { timeout: 30_000 }, async scope => {
  const directory = temporary(scope), home = join(directory, 'home'), workspace = join(directory, 'workspace');
  mkdirSync(home); mkdirSync(workspace);
  execFileSync('git', ['init', '--quiet', workspace]); prepareProject(workspace);
  const client = installTestRelease(privateDir(join(workspace, '.crossfire', 'software', 'fixture')));
  const provider = await nativeProvider(scope, home);
  const engine = await nativeEngine(scope, home, workspace, ['-c', 'approval_policy="on-request"', '-c', 'sandbox_mode="workspace-write"']);
  await materialize(engine, provider);
  const fixture = await matrixFixture(scope, workspace), stop = new AbortController();
  let disconnected: unknown;
  let runtime: CodexConnection | undefined;
  const receiving = listen({ ...fixture, reconcileMs: 120_000, limit: 20, pollMs: 100, debounceMs: 0,
    runtime: async (signal, pollMs, hooks) => { runtime = await connectCodex({ ...engine, pollMs, timeoutMs: 10_000, hooks }, signal); return runtime; },
  }, stop.signal).catch(error => { disconnected = error; return error; });
  cleanup(scope, async () => { stop.abort(); await receiving; });
  await until(() => fixture.waiting() > 0);
  await engine.call('thread/unsubscribe', { threadId: engine.session });
  const body = { msgtype: 'm.text', body: 'Intentional native Matrix reply.' };
  const arguments_ = [process.execPath, client, '--project', workspace, '--profile', 'watson', 'matrix', 'send-message',
    '--room-id', ROOM, '--event-type', 'm.room.message', '--txn-id', 'native-reply', '--body', JSON.stringify(body)];
  provider.tool('exec_command', { cmd: arguments_.map(argument => "'" + argument.replaceAll("'", "'\\''") + "'").join(' '),
    sandbox_permissions: 'require_escalated', justification: 'May the isolated fixture send its exact Matrix reply?', yield_time_ms: 1000 });
  fixture.add(ROOM, message('$intentional-native-reply', OBSERVER, 'Reply through the verified project-local client'));
  await until(() => fixture.rooms.get(OWNER_DM)!.some(event => String(event.content.body).includes('Permission needed')) || disconnected !== undefined);
  assert.equal(disconnected, undefined, String(disconnected));
  const request = fixture.rooms.get(OWNER_DM)!.find(event => String(event.content.body).includes('Permission needed'))!;
  fixture.add(OWNER_DM, { ...message('$approved-native-reply', OBSERVER, 'approve once'), content: { msgtype: 'm.text', body: 'approve once',
    'm.relates_to': { 'm.in_reply_to': { event_id: request.event_id } } } });
  await until(async () => fixture.rooms.get(ROOM)!.some(event => event.sender === SELF && event.content.body === body.body)
    || provider.requests.some(request => JSON.stringify(request).includes('function_call_output')) && !(await runtime!.inspect()).busy,
  'Native Matrix reply did not complete');
  assert(fixture.rooms.get(ROOM)!.some(event => event.sender === SELF && event.content.body === body.body),
    JSON.stringify(provider.requests));
  await until(async () => !(await runtime!.inspect()).busy);
  assert.equal(disconnected, undefined);
  assert(provider.requests.every(request => !JSON.stringify(request).includes('$approved-native-reply')));
  const thread = (await engine.call('thread/read', { threadId: engine.session })).thread as { id: string; canAcceptDirectInput: boolean };
  assert.equal(thread.id, engine.session);
  assert.equal(thread.canAcceptDirectInput, true);
});
