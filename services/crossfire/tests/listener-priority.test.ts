import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { createListenerHost } from '@ctlflow/crossfire-adapter-crossfire/listener-host';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import type { RuntimeAdapter } from '@ctlflow/crossfire-agent-core/runtime';
import type { ListenerBudget } from '@ctlflow/crossfire-agent-core/budget';
import { fakeCodex, inputReceipt, matrixFixture, mention, message, OWNER_DM, ROOM, THREAD, temporary, until } from '../scripts/test-support/listener.js';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { testClock } from '../scripts/test-support/clock.js';

test('86 enabled bindings watch concurrently and an accepted mention bypasses saturated ordinary acquisition/publication without advancing time', { timeout: 30000 }, async scope => {
  const clock = testClock(scope), host = await createListenerHost(), stop = new AbortController();
  cleanup(scope, () => host.close());
  const acquisition = await Promise.all(Array.from({ length: 16 }, () => host.budget.acquire('acquisition', stop.signal)));
  const publication = await Promise.all(Array.from({ length: 8 }, () => host.budget.acquire('publication', stop.signal)));
  const receivers: Promise<void>[] = [], matrices: Awaited<ReturnType<typeof matrixFixture>>[] = [];
  const delivered: { binding: number; text: string; priority: string | undefined }[] = [];
  const failures: unknown[] = [];
  cleanup(scope, async () => { stop.abort(); acquisition.forEach(release => release()); publication.forEach(release => release()); await Promise.all(receivers); });
  for (let binding = 0; binding < 86; binding++) {
    const matrix = await matrixFixture(scope, temporary(scope), clock); matrices.push(matrix);
    const runtime: RuntimeAdapter = async signal => ({ sessionId: THREAD, signal, approval: 'none',
      inspect: async () => ({ busy: false }), close: () => {}, acknowledge: () => {}, recover: async () => false, settle: async () => false,
      turnControl: { activeTurn: async () => null, interrupt: async () => 'inactive' },
      deliver: async (text, _id, cancelled, priority) => { cancelled?.throwIfAborted(); delivered.push({ binding, text, priority }); } });
    receivers.push(listen({ ...matrix, binding: 'scale-' + binding, host, runtime, clock, limit: 20, pollMs: 10000, reconcileMs: 30000, debounceMs: 1000 }, stop.signal)
      .catch(error => { if (!stop.signal.aborted) failures.push(error); }));
  }
  const observed = async (predicate: () => boolean) => {
    try { await until(() => {
      if (failures.length) throw failures[0];
      return predicate();
    }); } catch (error) {
      const matrix = matrices.at(-1);
      assert.fail(String(error) + ' Last binding requests: ' + JSON.stringify(matrix?.requests.slice(-20).map(request => request.path)));
    }
  };
  await observed(() => matrices.every(matrix => existsSync(matrix.cursorFile + '.sync') && matrix.waiting() === 1));
  assert.equal(host.size(), 86); assert.equal(delivered.length, 0);
  const matrix = matrices.at(-1)!;
  matrix.add(ROOM, mention('$urgent-at-scale', undefined, 'Inspect this immediately.'));
  await observed(() => delivered.some(input => input.text.includes('$urgent-at-scale')));
  assert.deepEqual(delivered.map(input => [input.binding, input.priority]), [[85, 'steering']]);
  assert.equal(clock.now(), 0, 'No polling timeout, debounce window, ordinary release or sleep was required');
  await observed(() => matrix.requests.some(request => request.path.includes(OWNER_DM) && request.path.includes('/send/')
    && String((request.body as { body?: string }).body).startsWith('Native input accepted')));
  const notices = matrix.requests.filter(request => request.path.includes(OWNER_DM) && request.path.includes('/send/'))
    .map(request => (request.body as { body: string; msgtype: string; 'org.crossfire.listener_notice': boolean }));
  assert.deepEqual(notices.map(notice => notice.body.split('\n')[0]), ['Mention received', 'Already idle — no turn interrupted', 'Native input accepted']);
  assert(notices.every(notice => notice.msgtype === 'm.notice' && notice['org.crossfire.listener_notice']));
  assert(notices.every(notice => notice.body.includes('$urgent-at-scale') && notice.body.includes(ROOM)));
  assert.equal(delivered.length, 1, 'Owner receipts do not generate model feedback');
});

test('a confirmed ordinary receipt waiting for an acquisition permit cannot hold captured-turn steering or cause replay', { timeout: 30000 }, async scope => {
  const clock = testClock(scope), host = await createListenerHost(), stop = new AbortController();
  cleanup(scope, () => host.close());
  const native = await fakeCodex(scope, { mode: 'accepted' }), matrix = await matrixFixture(scope, native.directory, clock);
  let saturated = false, blockedReads = 0;
  const budget: ListenerBudget = { acquire(kind, signal, admission) {
    if (saturated && kind === 'acquisition') blockedReads++;
    return host.budget.acquire(kind, signal, admission);
  } };
  const receiving = listen({ ...matrix, host: { ...host, budget }, reconcileMs: 120000, pollMs: 10000, debounceMs: 0, limit: 100,
    runtime: native.runtime }, stop.signal).catch(error => error);
  let held: (() => void)[] = [];
  cleanup(scope, async () => { stop.abort(); held.forEach(release => release()); await receiving; });
  const starts = () => native.requests().filter(request => request.method === 'turn/start');
  await until(() => matrix.waiting() === 1 && existsSync(matrix.cursorFile));
  const before = readJson(matrix.cursorFile);
  matrix.add(ROOM, message('$ordinary-before-mention'));
  await until(() => starts().length === 1 && matrix.waiting() === 1);
  held = await Promise.all(Array.from({ length: 16 }, () => host.budget.acquire('acquisition', stop.signal)));
  saturated = true;
  const first = starts()[0]!.params!;
  native.update({ mode: 'normal' });
  native.notify('item/completed', { threadId: THREAD, item: inputReceipt(String(first.clientUserMessageId), first.input) });
  await until(() => blockedReads > 0 && readJson<{ steps: { status: string }[] }>(matrix.cursorFile + '.chat-publication').steps[0]?.status === 'delivered');
  matrix.add(ROOM, mention('$mention-after-receipt', undefined, 'Stop and inspect this instead'));
  await until(() => starts().length === 2 && readJson<{ controls: { event: string; status: string }[] }>(matrix.cursorFile + '.control')
    .controls.some(control => control.event === '$mention-after-receipt' && control.status === 'delivered'));
  assert.equal(clock.now(), 0);
  assert.equal(native.requests().filter(request => request.method === 'turn/interrupt').length, 1);
  assert.match(JSON.stringify(starts()[1]!.params!.input), /\$mention-after-receipt/);
  assert.deepEqual(readJson(matrix.cursorFile), before);
  saturated = false; held.forEach(release => release()); held = [];
  await until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '2');
  assert.equal(starts().length, 2);
});
