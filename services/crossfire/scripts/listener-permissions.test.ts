import { cleanup } from '@crossfire/test-support/cleanup';
import { withClock } from './test-support/clock.js';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { listen } from '@crossfire/adapter-crossfire/listener';
import type { RuntimeHooks, Permission } from '@crossfire/agent-core/runtime';
import { isListenerNotice } from '@crossfire/contracts/notices';
import { readJson } from '@crossfire/adapter-filesystem/index';
import { matrixFixture, temporary, message, ROOM, OBSERVER, SELF, THREAD } from './test-support/listener.js';

const permission: Permission = { runtime: 'codex', session: THREAD, request: 'fixture-request', action: 'command',
  scope: { command: 'npm install', cwd: '/work/project' },
  choices: [{ label: 'approve once', value: { decision: 'accept' } }, { label: 'deny', value: { decision: 'decline' } }] };

for (const mode of ['paused', 'nobody'] as const) test('the single ' + mode + ' receiver handles owner approval without model input', withClock(async (scope, clock) => {

  const fixture = await matrixFixture(scope, temporary(scope), clock);
  if (mode === 'nobody') { fixture.waking.policy = 'nobody'; fixture.waking.senders = []; }
  const stop = new AbortController();
  let hooks: RuntimeHooks | undefined;
  const delivered: string[] = [];
  let closed = false;
  const receiving = listen({ ...fixture, approvalRoom: ROOM, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0,
    runtime: async (signal, _pollMs, callbacks) => {
      hooks = callbacks;
      return { sessionId: THREAD, signal, inspect: async () => ({ busy: false }), deliver: async text => { delivered.push(text); }, settle: async () => false, recover: async () => false, acknowledge: () => {},
        turnControl: { activeTurn: async () => null, interrupt: async () => {} }, close: () => { closed = true; } };
    },
  }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(receiving); });
  await clock.until(() => fixture.waiting() > 0);
  if (mode === 'paused') {
    fixture.add(ROOM, message('$pause', OBSERVER, '!!'));
    await clock.until(() => existsSync(fixture.cursorFile + '.control') && readJson<{ paused: boolean }>(fixture.cursorFile + '.control').paused);
  }
  assert(hooks);
  const pending = hooks.requestPermission(permission, stop.signal);
  await clock.until(() => fixture.rooms.get(ROOM)!.some(event => event.sender === SELF && String(event.content.body).includes('Permission needed')));
  const request = fixture.rooms.get(ROOM)!.find(event => event.sender === SELF && String(event.content.body).includes('Permission needed'))!;
  assert(isListenerNotice(request), 'Automatic native approvals cannot wake peer models');
  const reply = { ...message('$approval', OBSERVER, 'approve once'), content: { msgtype: 'm.text', body: 'approve once',
    'm.relates_to': { 'm.in_reply_to': { event_id: request.event_id } } } };
  fixture.add(ROOM, { ...reply, event_id: '$outsider', sender: '@administrator:elsewhere' });
  fixture.add(ROOM, reply);
  assert.deepEqual(await clock.complete(pending), { decision: 'accept' });
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

test('a runtime permission without a selected authorized conversation fails closed', withClock(async (scope, clock) => {

  const fixture = await matrixFixture(scope, temporary(scope), clock);
  const stop = new AbortController();
  let hooks: RuntimeHooks | undefined;
  const receiving = listen({ ...fixture, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0,
    runtime: async (signal, _pollMs, callbacks) => {
      hooks = callbacks;
      return { sessionId: THREAD, signal, inspect: async () => ({ busy: false }), deliver: async () => {}, settle: async () => false, recover: async () => false, acknowledge: () => {},
        turnControl: { activeTurn: async () => null, interrupt: async () => {} }, close: () => {} };
    },
  }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(receiving); });
  await clock.until(() => fixture.waiting() > 0);
  assert(hooks);
  await assert.rejects(hooks.requestPermission(permission, stop.signal), /explicitly selected authorized/);
  assert.equal(fixture.requests.some(request => request.path.includes('/send/')), false);
}));
