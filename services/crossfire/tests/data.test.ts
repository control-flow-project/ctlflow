import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openStore } from "../apps/server/src/data/database.js";
import * as queries from "../apps/server/src/data/queries.js";
import { context, hash, secret } from "../apps/server/src/context.js";
import { decide, requestEnrollment } from "../apps/server/src/enrollment.js";
import type { Result } from "../packages/kernel/src/result.js";

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? "" : result.error.message);
  return result.value;
}

function directory(): string {
  mkdirSync(join(process.cwd(), ".temp"), { recursive: true });
  return mkdtempSync(join(process.cwd(), ".temp/durable-management-"));
}

test("private management state survives reopen with native foreign keys, rollback and quota reservations", () => {
  const path = join(directory(), "private/management.sqlite");
  let store = openStore(path);
  const config = { instance: "tests", serverName: "tests.localhost", publicOrigin: "http://127.0.0.1",
    matrixOrigin: "http://127.0.0.1", administrator: "@admin:tests.localhost", registrationSecret: secret(), jwtSecret: secret() };
  const ctx = context(store, config);
  const credential = secret();
  const human = { id: config.administrator, sessionHash: hash(credential) };
  queries.insertSession(store, { hash: human.sessionHash, member: human.id, token: "fixture", csrf: "fixture", expires: Date.now() + 60_000 });
  const request = value(requestEnrollment(ctx, { owner: human.id, name: "Holmes" })) as { id: string; code: string };
  const decision = value(decide(ctx, human, request.id, { decision: "approve", code: request.code })) as { agent: string };
  const agent = queries.agent(store, decision.agent)!;
  assert.equal(agent.wakePolicy, 'owner');
  assert.throws(() => store.transaction(() => {
    queries.changeAgent(store, agent.id, 0, "suspended", null, "[]", 0, agent.wakePolicy);
    throw Error("rollback");
  }).immediate(), /rollback/);
  assert.equal(queries.agent(store, agent.id)!.status, "active");
  assert.throws(() => queries.insertEnrollment(store, { ...queries.enrollment(store, request.id)!,
    id: secret(), code: secret(), agent: null, owner: "@missing:tests.localhost" }), /FOREIGN KEY/);
  assert.equal(store.pragma("journal_mode", { simple: true }), "delete");
  const pageSize = store.pragma("page_size", { simple: true });
  const maxPages = store.pragma("max_page_count", { simple: true });
  assert(typeof pageSize === "number" && typeof maxPages === "number");
  assert(pageSize * maxPages <= 256 * 1024 * 1024);
  store.exec('ALTER TABLE agents DROP COLUMN wakePolicy');
  store.close();
  store = openStore(path);
  assert.deepEqual(queries.agent(store, agent.id), agent);
  assert.equal(queries.enrollment(store, request.id)!.agent, agent.id);
  assert.equal(queries.agents(store, "", true).length, 1);
  assert.equal(queries.changeAgent(store, agent.id, 0, agent.status, agent.override, agent.grants, agent.grantRevision, 'humans'), 1);
  assert.equal(queries.changeAgent(store, agent.id, 0, agent.status, agent.override, agent.grants, agent.grantRevision, 'everyone'), 0);
  store.close(); store = openStore(path);
  assert.equal(queries.agent(store, agent.id)!.wakePolicy, 'humans');
  assert.equal(store.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(path, "..")).mode & 0o777, 0o700);
  const reopened = context(store, config);
  assert.equal(decide(reopened, human, request.id, { decision: "approve", code: request.code }).ok, false);
  assert.equal(queries.agents(store, "", true).length, 1);
  store.close();
});

test("management database does not follow a symlink or silently adopt a public file", () => {
  const root = directory();
  const publicFile = join(root, "public.sqlite");
  writeFileSync(publicFile, "unrelated", { mode: 0o644 });
  assert.throws(() => openStore(publicFile), /private/);
  assert.equal(statSync(publicFile).mode & 0o777, 0o644);
  chmodSync(publicFile, 0o600);
  const linked = join(root, "linked.sqlite");
  symlinkSync(publicFile, linked);
  assert.throws(() => openStore(linked), /regular/);
});

test('policy schema adds empty instructions without changing existing limits and persists text through Tinqer', () => {
  const path = join(directory(), 'management.sqlite');
  let store = openStore(path);
  const expected = { revision: 4, maxOwnerAgents: 7, maxAgents: 50, maxPending: 35,
    enrollmentSeconds: 120, reconcileSeconds: 300, agentInstructions: '' };
  queries.insertPolicy(store, expected);
  store.exec('ALTER TABLE policy DROP COLUMN agentInstructions');
  store.close();
  store = openStore(path);
  assert.deepEqual(queries.readPolicy(store), expected);
  const changed = { ...expected, agentInstructions: 'Use "project" tickets.\nKeep secrets private. 東京' };
  assert.equal(queries.updatePolicy(store, changed), 1);
  assert.equal(queries.updatePolicy(store, { ...changed, agentInstructions: 'stale' }), 0);
  store.close();
  store = openStore(path);
  assert.deepEqual(queries.readPolicy(store), { ...changed, revision: 5 });
  assert.equal(store.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(queries.updatePolicy(store, { ...changed, revision: 5, agentInstructions: '' }), 1);
  assert.deepEqual(queries.readPolicy(store), { ...expected, revision: 6 });
  store.close();
});
