import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { listen } from '../packages/agent-core/src/listen.js';
import { fakeCodex, matrixFixture, message, ROOM, until } from './test-support/listener.js';

test('listener reports zero-room activity without model input and obeys server disconnect without new skills', async scope => {
  const runtime = await fakeCodex(scope);
  const matrix = await matrixFixture(scope, runtime.directory);
  matrix.joined.clear();
  matrix.reporting.disconnect = true;
  await assert.rejects(listen({ ...matrix, runtime: runtime.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, new AbortController().signal), /requested.*disconnect/);
  assert.equal(runtime.requests().filter(request => request.method === 'turn/start').length, 0);
  const beats = matrix.requests.filter(request => request.path.endsWith('/heartbeat'));
  assert.equal(beats.length, 2);
  const first = beats[0]!.body as { run: string; messages: number; stopped: boolean };
  assert.equal(first.messages, 0);
  assert.equal(first.stopped, false);
  assert.deepEqual(beats[1]!.body, { ...first, stopped: true });
});

test('listener counts confirmed chat inputs, not state notices, and stops reporting on adapter disconnect', async scope => {
  const runtime = await fakeCodex(scope);
  const matrix = await matrixFixture(scope, runtime.directory);
  const stop = new AbortController();
  const running = listen({ ...matrix, runtime: runtime.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, stop.signal).catch(error => error);
  scope.after(async () => { stop.abort(); await running; });
  await until(() => matrix.waiting() === 1);
  matrix.add(ROOM, message('$chat'), { ...message('$renamed'), type: 'm.room.name', state_key: '', content: { name: 'A room' } });
  await until(() => existsSync(matrix.cursorFile) && JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === '2');
  runtime.disconnect();
  assert(await running instanceof Error);
  const beats = matrix.requests.filter(request => request.path.endsWith('/heartbeat'));
  assert.equal((beats.at(-1)!.body as { stopped: boolean }).stopped, true);
  assert.equal((beats.at(-1)!.body as { messages: number }).messages, 1);
});
