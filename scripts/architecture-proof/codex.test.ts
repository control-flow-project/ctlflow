import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { codexFixture, until } from "./codex-fixture.js";
import { object } from "./native-http.js";

test("actual Codex TUI switch and abrupt closure leave the native thread input-capable", { timeout: 90_000 }, async context => {
  const fixture = await codexFixture(context, false);
  const { observer, threadId, server } = fixture;
  const before = object((await observer.call("thread/read", { threadId, includeTurns: false })).thread);
  assert.equal(before.id, threadId);
  assert.equal(before.canAcceptDirectInput, true);
  const pane = await fixture.tmux(["display-message", "-p", "-t", "fixture", "#{pane_pid}"]);
  const tuiPid = Number(pane.stdout.trim());
  assert(Number.isSafeInteger(tuiPid) && tuiPid > 0);
  await delay(1000);
  await fixture.type("/new");
  await until(() => observer.notifications.filter(value => value.method === "thread/started").length >= 2,
    "Real TUI did not switch to a new native thread");
  const switched = object((await observer.call("thread/read", { threadId, includeTurns: false })).thread);
  assert.equal(switched.canAcceptDirectInput, true);
  assert.equal(observer.notifications.some(value => value.method === "thread/closed" && value.params.threadId === threadId), false);
  const currentPane = await fixture.tmux(["display-message", "-p", "-t", "fixture", "#{pane_pid}"]);
  assert.equal(Number(currentPane.stdout.trim()), tuiPid);
  process.kill(tuiPid, "SIGTERM");
  await until(async () => !(await fixture.active()), "Fixture TUI did not stop");
  assert.equal(server.exitCode, null, "Native server must survive the TUI closure");
  const after = object((await observer.call("thread/read", { threadId, includeTurns: false })).thread);
  assert.equal(after.id, threadId);
  assert.equal(after.canAcceptDirectInput, true);
  console.log("GAP exact TUI lifecycle:", JSON.stringify({
    oldThread: threadId, samePidSwitch: true, switched: switched.status, afterExit: after.status,
    canAcceptDirectInput: after.canAcceptDirectInput, nativeServerSurvived: server.exitCode === null,
  }));
});

test("normal TUI quit has no immediate SessionEnd while explicit native archive does", { timeout: 90_000 }, async context => {
  const fixture = await codexFixture(context, true);
  const { observer, threadId, server } = fixture;
  await delay(1000);
  await fixture.type("Materialize fixture session; provider is deliberately unavailable.");
  await until(() => fixture.recorded().some(event => event.hook_event_name === "SessionStart" && event.session_id === threadId),
    "SessionStart positive control did not run");
  await fixture.type("/quit");
  await until(async () => !(await fixture.active()), "Fixture TUI did not quit normally");
  assert.equal(server.exitCode, null, "Native server must survive normal TUI quit");
  await delay(2000);
  const after = object((await observer.call("thread/read", { threadId, includeTurns: false })).thread);
  assert.equal(after.id, threadId);
  assert.equal(after.canAcceptDirectInput, true);
  assert.equal(fixture.recorded().some(event => event.hook_event_name === "SessionEnd" && event.session_id === threadId), false);
  assert.equal(observer.notifications.some(event => event.method === "thread/closed" && event.params.threadId === threadId), false);
  console.log("GAP normal quit:", JSON.stringify({ threadId, canAcceptDirectInput: after.canAcceptDirectInput,
    observedMilliseconds: 2000, hooks: fixture.recorded(), nativeServerSurvived: server.exitCode === null }));
  await observer.call("thread/archive", { threadId });
  await until(() => fixture.recorded().some(event => event.hook_event_name === "SessionEnd" && event.session_id === threadId),
    "SessionEnd positive control did not run on explicit native archive");
  console.log("Native archive positive control:", JSON.stringify(fixture.recorded()));
});
