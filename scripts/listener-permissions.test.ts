import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { listen } from '../packages/agent-core/src/listen.js';
import type { RuntimeHooks, Permission } from '../packages/agent-core/src/runtime.js';
import { readJson } from '../packages/files/src/index.js';
import { matrixFixture, temporary, until, message, ROOM, OBSERVER, SELF, THREAD } from './test-support/listener.js';

const permission: Permission = { runtime: 'codex', session: THREAD, request: 'fixture-request', action: 'command',
  scope: { command: 'npm install', cwd: '/work/project' },
  choices: [{ label: 'approve once', value: { decision: 'accept' } }, { label: 'deny', value: { decision: 'decline' } }] };

test('the single paused receiver handles owner approval without resuming delivery or sending it to the model', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope));
  const stop = new AbortController();
  let hooks: RuntimeHooks | undefined;
  const delivered: string[] = [];
  let closed = false;
  const receiving = listen({ ...fixture, approvalRoom: ROOM, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0,
    runtime: async (signal, _pollMs, callbacks) => {
      hooks = callbacks;
      return { sessionId: THREAD, signal, deliver: async text => { delivered.push(text); }, settle: async () => false,
        activeTurn: async () => null, interrupt: async () => {}, close: () => { closed = true; } };
    },
  }, stop.signal).catch(error => error);
  scope.after(async () => { stop.abort(); await receiving; });
  await until(() => fixture.waiting() > 0);
  fixture.add(ROOM, message('$pause', OBSERVER, '!!'));
  await until(() => existsSync(fixture.cursorFile + '.control') && readJson<{ paused: boolean }>(fixture.cursorFile + '.control').paused);
  assert(hooks);
  const pending = hooks.requestPermission(permission, stop.signal);
  await until(() => fixture.rooms.get(ROOM)!.some(event => event.sender === SELF && String(event.content.body).includes('Permission needed')));
  const request = fixture.rooms.get(ROOM)!.find(event => event.sender === SELF && String(event.content.body).includes('Permission needed'))!;
  const reply = { ...message('$approval', OBSERVER, 'approve once'), content: { msgtype: 'm.text', body: 'approve once',
    'm.relates_to': { 'm.in_reply_to': { event_id: request.event_id } } } };
  fixture.add(ROOM, { ...reply, event_id: '$outsider', sender: '@administrator:elsewhere' });
  fixture.add(ROOM, reply);
  assert.deepEqual(await pending, { decision: 'accept' });
  assert.equal(readJson<{ paused: boolean }>(fixture.cursorFile + '.control').paused, true);
  assert.equal(delivered.length, 0);
  fixture.add(ROOM, message('$resume', OBSERVER, 'Continue the project'));
  await until(() => delivered.some(text => text.includes('$resume')));
  assert(delivered.every(text => !text.includes('$approval') && !text.includes('$outsider')));
  stop.abort(new Error('Owner ended the foreground run'));
  assert.match(String(await receiving), /Owner ended/);
  assert.equal(closed, true);
});

test('a runtime permission without a selected authorized conversation fails closed', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope));
  const stop = new AbortController();
  let hooks: RuntimeHooks | undefined;
  const receiving = listen({ ...fixture, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0,
    runtime: async (signal, _pollMs, callbacks) => {
      hooks = callbacks;
      return { sessionId: THREAD, signal, deliver: async () => {}, settle: async () => false, activeTurn: async () => null,
        interrupt: async () => {}, close: () => {} };
    },
  }, stop.signal).catch(error => error);
  scope.after(async () => { stop.abort(); await receiving; });
  await until(() => fixture.waiting() > 0);
  assert(hooks);
  await assert.rejects(hooks.requestPermission(permission, stop.signal), /explicitly selected authorized/);
  assert.equal(fixture.requests.some(request => request.path.includes('/send/')), false);
});
