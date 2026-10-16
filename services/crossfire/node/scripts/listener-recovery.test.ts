import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { withClock } from './test-support/clock.js';
import { localState as storage } from '@ctlflow/crossfire-adapter-filesystem/state';
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import { readJson } from "@ctlflow/crossfire-adapter-filesystem/index";
import { loadControl } from "@ctlflow/crossfire-agent-core/control";
import { createListenerControl } from '@ctlflow/crossfire-agent-core/listener-control';
import { fakeCodex, matrixFixture, message, OBSERVER, ROOM, THREAD, CONTROLLER } from "./test-support/listener.js";

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

test('server admission loss pauses delivery and rebinds the same desired receiver rather than treating it as an owner stop', withClock(async (scope, clock) => {
  const native = await fakeCodex(scope), matrix = await matrixFixture(scope, native.directory, clock), stop = new AbortController();
  const notices: string[] = [], binding = createListenerControl(async () => {}, () => matrix.reporting.controller, reason => notices.push(reason));
  binding.update({ active: true, input: null });
  matrix.reporting.disconnect = true;
  let finished = false;
  const result = listen({ ...matrix, control: binding.connection, reconcileMs: 1000, limit: 100, pollMs: 100, debounceMs: 0, runtime: native.runtime }, stop.signal)
    .catch(error => error).finally(() => { finished = true; });
  cleanup(scope, async () => { stop.abort(); await clock.complete(result); });
  await clock.until(() => notices.length === 1);
  assert.equal(binding.connection.current().active, false); assert.equal(finished, false);
  matrix.add(ROOM, message('$unread-after-admission-loss')); await clock.advance(20);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  matrix.reporting.disconnect = false; matrix.reporting.controller = { ...CONTROLLER, connectionId: 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee' };
  binding.update({ active: true, input: null });
  await clock.until(() => existsSync(matrix.cursorFile) && readJson<Record<string, string>>(matrix.cursorFile)[ROOM] === '1');
  assert.equal(native.requests().filter(request => request.method === 'thread/resume').length, 1);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 1); assert.equal(finished, false);
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
