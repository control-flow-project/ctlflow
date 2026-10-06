import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { withClock } from './test-support/clock.js';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import type { RuntimeHooks, RuntimeDecision } from '@ctlflow/crossfire-agent-core/runtime';
import { isListenerNotice } from '@ctlflow/crossfire-contracts/notices';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { success } from '@ctlflow/crossfire-kernel/result';
import { fakeCodex, matrixFixture, temporary, message, ROOM, OWNER_DM, AGENT_ID, OBSERVER, SELF, THREAD } from './test-support/listener.js';

const permission: RuntimeDecision = { runtime: 'codex', session: THREAD, request: 'fixture-request', action: 'command', turn: 'original-turn', item: 'original-item', blocking: true,
  scope: { command: 'npm install', cwd: '/work/project' },
  choices: [{ label: 'approve once', value: { decision: 'accept' } }, { label: 'deny', value: { decision: 'decline' } }] };

for (const mode of ['paused', 'nobody'] as const) test('the single ' + mode + ' receiver handles owner approval without model input', withClock(async (scope, clock) => {

  const fixture = await matrixFixture(scope, temporary(scope), clock);
  if (mode === 'nobody') fixture.joined.delete(OWNER_DM);
  if (mode === 'nobody') { fixture.waking.policy = 'nobody'; fixture.waking.senders = []; }
  const stop = new AbortController();
  let hooks: RuntimeHooks | undefined;
  const delivered: string[] = [];
  let closed = false;
  const receiving = listen({ ...fixture, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0,
    runtime: async (signal, _pollMs, callbacks) => {
      hooks = callbacks;
      return { sessionId: THREAD, approval: 'listener', signal, inspect: async () => ({ busy: false }), deliver: async text => { delivered.push(text); }, settle: async () => false, recover: async () => false, acknowledge: () => {},
        turnControl: { activeTurn: async () => null, interrupt: async () => {} }, close: () => { closed = true; } };
    },
  }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(receiving); });
  await clock.until(() => fixture.waiting() > 0);
  assert.equal(fixture.requests.some(request => request.path.endsWith('/owner-conversation')), false, 'Listener startup never creates a conversation');
  if (mode === 'paused') {
    fixture.add(ROOM, message('$pause', OBSERVER, '!!'));
    await clock.until(() => existsSync(fixture.cursorFile + '.control') && readJson<{ paused: boolean }>(fixture.cursorFile + '.control').paused);
  }
  assert(hooks);
  const pending = hooks.requestDecision(permission, stop.signal);
  await clock.until(() => fixture.rooms.get(OWNER_DM)!.some(event => event.sender === SELF && String(event.content.body).includes('review and answer')));
  const request = fixture.rooms.get(OWNER_DM)!.find(event => event.sender === SELF && String(event.content.body).includes('review and answer'))!;
  assert(isListenerNotice(request), 'Automatic native approvals cannot wake peer models');
  assert(String(request.content.body).includes('/manage/agents/' + AGENT_ID + '/decisions/'));
  fixture.answerDecision([...fixture.decisions.keys()][0]!);
  assert.deepEqual(await clock.complete(pending), success({ decision: 'accept' }));
  hooks.decisionResponded?.(permission);
  assert.equal(readJson<{ paused: boolean }>(fixture.cursorFile + '.control').paused, mode === 'paused');
  assert.equal(delivered.length, 0);
  fixture.add(ROOM, message('$resume', OBSERVER, 'Continue the project'));
  if (mode === 'nobody') {
    await clock.advance(150); assert.equal(delivered.length, 0);
    fixture.waking.policy = 'owner'; fixture.waking.senders = [OBSERVER];
  }
  await clock.until(() => delivered.some(text => text.includes('$resume')));
  assert(delivered.every(text => !text.includes('$approval') && !text.includes('$outsider')));
  stop.abort(new Error('Owner ended the foreground run'));
  assert.match(String(await clock.complete(receiving)), /Owner ended/);
  assert.equal(closed, true);
}));

test('an unavailable first-use owner DM denies only that permission request, not a roomless listener', withClock(async (scope, clock) => {

  const fixture = await matrixFixture(scope, temporary(scope), clock);
  fixture.joined.clear();
  fixture.failures.set('/api/agents/' + AGENT_ID + '/owner-conversation', [503]);
  const stop = new AbortController();
  let ready = false, closed = false;
  let hooks: RuntimeHooks | undefined;
  const receiving = listen({ ...fixture, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0,
    ready: () => { ready = true; },
    runtime: async (signal, _pollMs, callbacks) => {
      hooks = callbacks;
      return { sessionId: THREAD, approval: 'listener', signal, inspect: async () => ({ busy: false }), deliver: async () => {}, settle: async () => false, recover: async () => false, acknowledge: () => {},
        turnControl: { activeTurn: async () => null, interrupt: async () => {} }, close: () => { closed = true; } };
    },
  }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(receiving); });
  await clock.until(() => ready && fixture.waiting() > 0);
  assert(hooks);
  assert.equal(fixture.requests.some(request => request.path.endsWith('/owner-conversation')), false);
  const result = await clock.complete(hooks.requestDecision(permission, stop.signal));
  assert.equal(result.ok, false);
  assert.equal(ready, true);
  assert.equal(closed, false);
  assert.equal(fixture.requests.some(request => request.path.includes('/listener-runs')), true);
  assert.equal(fixture.requests.some(request => request.path.includes('/send/')), false);
  stop.abort(); await clock.complete(receiving);
  assert.equal(closed, true);
}));

for (const condition of ['read-only', 'muted', 'owner-absent', 'native-unavailable'] as const) {
  test('native approval readiness rejects ' + condition + ' before reporting online', withClock(async (scope, clock) => {
    const native = await fakeCodex(scope, { approvalPolicy: 'on-request' });
    const fixture = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
    if (condition === 'read-only') fixture.accessModes.set(OWNER_DM, 'read');
    if (condition === 'muted') fixture.muted.add(OWNER_DM);
    if (condition === 'owner-absent') fixture.missingObserver.add(OWNER_DM);
    if (condition === 'native-unavailable') fixture.failures.set('/_matrix/client/v3/rooms/' + OWNER_DM + '/state', [503]);
    let ready = false;
    const receiving = listen({ ...fixture, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0,
      ready: () => { ready = true; }, runtime: native.runtime }, stop.signal).catch(error => error);
    cleanup(scope, async () => { stop.abort(); await clock.complete(receiving); });
    assert.match(String(await clock.complete(receiving)), /Native approval setup is not ready/);
    assert.equal(ready, false);
    assert.equal(native.requests().some(request => request.method === 'turn/start'), false);
    assert.equal(fixture.requests.some(request => request.path.includes('/listener-runs')), false);
  }));
}
