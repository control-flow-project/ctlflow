import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import { fakeCodex, matrixFixture, message, ROOM, until } from './test-support/listener.js';
import { createListenerControl } from '@ctlflow/crossfire-agent-core/listener-control';

test('listener with only an owner DM reports activity without model input and pauses on expired admission', async scope => {
  const runtime = await fakeCodex(scope);
  const matrix = await matrixFixture(scope, runtime.directory);
  matrix.joined.delete(ROOM);
  matrix.reporting.disconnect = true;
  const stop = new AbortController(), binding = createListenerControl(async () => {}, () => matrix.reporting.controller);
  binding.update({ connected: true, active: true, input: null });
  let finished = false;
  const receiving = listen({ ...matrix, control: binding.connection, runtime: runtime.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, stop.signal)
    .catch(error => error).finally(() => { finished = true; });
  cleanup(scope, async () => { stop.abort(); await receiving; });
  await until(() => matrix.requests.some(request => request.path.includes('/listener-runs/') && (request.body as { stopped: boolean }).stopped));
  assert.equal(binding.connection.current().active, false); assert.equal(finished, false);
  assert.equal(runtime.requests().filter(request => request.method === 'turn/start').length, 0);
  const beats = matrix.requests.filter(request => request.path.includes('/listener-runs/') && !request.path.endsWith('/runtime'));
  assert.equal(beats.length, 2);
  const first = beats[0]!.body as { run: string; messagesDelivered: number; stopped: boolean };
  assert.equal(first.messagesDelivered, 0);
  assert.equal(first.stopped, false);
  assert.deepEqual(beats[1]!.body, { ...first, stopped: true });
});

test('listener counts confirmed chat inputs, not state notices, and stops reporting on adapter disconnect', async scope => {
  const runtime = await fakeCodex(scope);
  const matrix = await matrixFixture(scope, runtime.directory);
  const stop = new AbortController();
  const running = listen({ ...matrix, runtime: runtime.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await running; });
  await until(() => matrix.waiting() === 1);
  matrix.add(ROOM, message('$chat'), { ...message('$renamed'), type: 'm.room.name', state_key: '', content: { name: 'A room' } });
  await until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '2');
  runtime.disconnect();
  assert(await running instanceof Error);
  const beats = matrix.requests.filter(request => request.path.includes('/listener-runs/'));
  assert.equal((beats.at(-1)!.body as { stopped: boolean }).stopped, true);
  assert.equal((beats.at(-1)!.body as { messagesDelivered: number }).messagesDelivered, 1);
});
