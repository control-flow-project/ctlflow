import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { connectCodex } from '@crossfire/adapter-codex/connection';
import { nativeEngine, materialize } from '../test-support/native-engine.js';
import { nativeProvider } from '../test-support/native-provider.js';
import { matrixFixture, message, temporary, until, ROOM, SELF, OBSERVER } from '../test-support/listener.js';

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
  const receiving = listen({ ...fixture, approvalRoom: ROOM, reconcileMs: 120_000, limit: 20, pollMs: 100, debounceMs: 0,
    runtime: (signal, pollMs, hooks) => connectCodex({ ...engine, pollMs, timeoutMs: 10_000,
      hooks: { requestPermission: (permission, cancelled) => {
        nativeRequest = true;
        assert.equal(permission.runtime, 'codex');
        assert(JSON.stringify(permission.scope).includes('printf native-approved'));
        return hooks.requestPermission(permission, cancelled);
      } },
    }, signal),
  }, stop.signal).catch(error => { failure = error; return error; });
  scope.after(async () => {
    stop.abort(); await receiving;
  });
  await until(() => fixture.waiting() > 0);
  provider.tool('exec_command', { cmd: 'printf native-approved', sandbox_permissions: 'require_escalated',
    justification: 'May the isolated fixture print its approval marker?', max_output_tokens: 100, yield_time_ms: 1000 });
  fixture.add(ROOM, message('$native-permission-input', OBSERVER, 'Run the isolated permission fixture'));
  await until(() => nativeRequest || failure !== undefined, 'Native permission was not observed');
  assert.equal(failure, undefined, String(failure));
  await until(() => fixture.rooms.get(ROOM)!.some(event => event.sender === SELF && String(event.content.body).includes('Permission needed')));
  const request = fixture.rooms.get(ROOM)!.find(event => event.sender === SELF && String(event.content.body).includes('Permission needed'))!;
  const approval = { ...message('$native-owner-decision', OBSERVER, 'approve once'), content: { msgtype: 'm.text', body: 'approve once',
    'm.relates_to': { 'm.in_reply_to': { event_id: request.event_id } } } };
  fixture.add(ROOM, { ...approval, event_id: '$native-outsider', sender: '@other:test.localhost' });
  assert.equal(provider.requests.some(request => JSON.stringify(request).includes('native-approved\n')), false);
  fixture.add(ROOM, approval);
  await until(() => provider.requests.some(request => JSON.stringify(request).includes('native-approved')
    && JSON.stringify(request).includes('function_call_output')), 'Native permission decision did not complete the command');
  assert(existsSync(fixture.cursorFile));
  assert(provider.requests.every(request => !JSON.stringify(request).includes('$native-owner-decision')
    && !JSON.stringify(request).includes('$native-outsider')));
  stop.abort(new Error('Native permission proof complete'));
  assert.match(String(await receiving), /proof complete/);
});
