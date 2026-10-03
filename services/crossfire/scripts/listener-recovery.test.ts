import { cleanup } from '@crossfire/test-support/cleanup';
import { withClock } from './test-support/clock.js';
import { localState as storage } from '@crossfire/adapter-filesystem/state';
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { listen } from '@crossfire/adapter-crossfire/listener';
import { readJson } from "@crossfire/adapter-filesystem/index";
import { loadControl } from "@crossfire/agent-core/control";
import { isListenerStop } from '@crossfire/agent-core/lifecycle';
import { fakeCodex, matrixFixture, message, OBSERVER, ROOM, THREAD } from "./test-support/listener.js";

test("one bounded reconciliation receiver recovers missed notifications and important state exactly once", withClock(async (scope, clock) => {

  const native = await fakeCodex(scope);
  const matrix = await matrixFixture(scope, native.directory, clock);
  const stop = new AbortController();
  const result = listen({ ...matrix, reconcileMs: 1000, limit: 2, pollMs: 100, debounceMs: 0, runtime: native.runtime }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(result); });
  await clock.until(() => existsSync(matrix.cursorFile) && matrix.waiting() === 1);
  const before = readJson(matrix.cursorFile);
  matrix.syncUpdates.enabled = false;
  matrix.add(ROOM, message("$missed"), { ...message("$rename", OBSERVER), type: "m.room.name", state_key: "", content: { name: "Coffee Day" } },
    { ...message("$avatar", OBSERVER), type: "m.room.avatar", state_key: "", content: { url: "mxc://test/avatar" } },
    { ...message("$topic", OBSERVER), type: "m.room.topic", state_key: "", content: { topic: "Coordination" } });
  await clock.advance(200);
  assert.deepEqual(readJson(matrix.cursorFile), before);
  const starts = () => native.requests().filter(request => request.method === "turn/start");
  assert.equal(starts().length, 0);
  await clock.until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === "4");
  const ids = starts().flatMap(request => {
    const input = request.params!.input as { text: string }[];
    const batch = JSON.parse(input[0]!.text.slice(input[0]!.text.indexOf("\n") + 1)) as { events: { event_id: string; state_key?: string }[] };
    assert(batch.events.length > 0 && batch.events.length <= 2);
    for (const event of batch.events.filter(event => event.event_id !== "$missed")) assert.equal(event.state_key, "");
    return batch.events.map(event => event.event_id);
  });
  assert.deepEqual(ids, ["$missed", "$rename", "$topic"]);
  assert.equal(starts().length, 3);
  const count = starts().length;
  await clock.advance(1100);
  assert.equal(starts().length, count);
}));

test("reconciliation respects human pause, mute and suspension without empty model turns", withClock(async (scope, clock) => {

  const native = await fakeCodex(scope);
  const matrix = await matrixFixture(scope, native.directory, clock);
  const stop = new AbortController();
  const result = listen({ ...matrix, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0, runtime: native.runtime }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(result); });
  await clock.until(() => existsSync(matrix.cursorFile) && matrix.waiting() === 1);
  matrix.add(ROOM, message("$pause", OBSERVER, "!!"));
  await clock.until(() => loadControl(storage, matrix.cursorFile + ".control", THREAD).paused);
  matrix.syncUpdates.enabled = false;
  matrix.add(ROOM, message("$paused-backlog"));
  await clock.advance(1100);
  assert.equal(native.requests().filter(request => request.method === "turn/start").length, 0);
  assert(loadControl(storage, matrix.cursorFile + ".control", THREAD).paused);
  matrix.muted.add(ROOM);
  matrix.access.status = "suspended";
  assert.match(String(await clock.complete(result)), /no longer active/);
  assert.equal(native.requests().filter(request => request.method === "turn/start").length, 0);
}));

test('owner disconnection propagates an intentional lifecycle outcome, not a runtime failure', withClock(async (scope, clock) => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
  matrix.reporting.disconnect = true;
  const result = listen({ ...matrix, reconcileMs: 1000, limit: 100, pollMs: 100, debounceMs: 0, runtime: native.runtime }, stop.signal).catch(error => error);
  cleanup(scope, async () => { stop.abort(); await clock.complete(result); });
  assert(isListenerStop(await clock.complete(result)));
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
}));

test("a hung acquisition is cancelled within its deadline and retried without dropping the listener or advancing unread cursors", withClock(async (scope, clock) => {
  const native = await fakeCodex(scope);
  const matrix = await matrixFixture(scope, native.directory, clock);
  matrix.syncUpdates.hung = true;
  const stop = new AbortController();
  let finished = false;
  const result = listen({ ...matrix, reconcileMs: 1000, limit: 20, pollMs: 100, debounceMs: 0,
    runtime: native.runtime }, stop.signal).catch(error => error).finally(() => { finished = true; });
  cleanup(scope, async () => { stop.abort(); await clock.complete(result); });
  await clock.until(() => matrix.requests.filter(request => request.path.endsWith('/sync')).length >= 2);
  assert.equal(finished, false);
  assert.equal(existsSync(matrix.cursorFile), false);
  assert.equal(native.requests().filter(request => request.method === "turn/start").length, 0);
  matrix.syncUpdates.hung = false;
  await clock.until(() => existsSync(matrix.cursorFile));
  matrix.add(ROOM, message('$after-timeout'));
  await clock.until(() => readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '1');
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1);
  assert.equal(finished, false);
}));
