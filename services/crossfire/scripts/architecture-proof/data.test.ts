import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { join } from "node:path";
import test from "node:test";
import { defineSelect } from "@tinqerjs/tinqer";
import { executeInsert, executeSelect, executeUpdate, toSql } from "@tinqerjs/better-sqlite3-adapter";
import { insertAgent, openDatabase, readAgent, readOwnerAgents, schema } from "./data-fixture.js";

test("published Tinqer binds untrusted values and scopes SELECT to the supplied owner", () => {
  const database = openDatabase();
  try {
    insertAgent(database, { id: "holmes", owner: "alice", name: "Holmes", revision: 0 });
    insertAgent(database, { id: "watson", owner: "bob", name: "Watson", revision: 0 });
    const hostile = "alice' OR 1=1; DROP TABLE agents; --";
    insertAgent(database, { id: "literal", owner: hostile, name: hostile, revision: 0 });
    assert.deepEqual(readOwnerAgents(database, "alice").map(agent => agent.id), ["holmes"]);
    assert.equal(readAgent(database, "bob", "holmes"), null);
    assert.equal(readAgent(database, "alice", "holmes")?.name, "Holmes");
    assert.deepEqual(readOwnerAgents(database, hostile).map(agent => agent.id), ["literal"]);
    const compiled = toSql(defineSelect(schema, (query, params: { owner: string }) =>
      query.from("agents").where(agent => agent.owner === params.owner)), { owner: hostile });
    assert(!compiled.sql.includes(hostile));
    assert.equal(compiled.params.owner, hostile);
    assert.equal(executeSelect(database, schema, query => query.from("agents").count()), 3);
  } finally {
    database.close();
  }
});

test("a native immediate transaction commits the agent and audit together", () => {
  const database = openDatabase();
  try {
    database.transaction(() => {
      insertAgent(database, { id: "holmes", owner: "alice", name: "Holmes", revision: 0 });
      executeInsert(database, schema, (query, params) => query.insertInto("audit").values({
        id: params.id, agent: params.agent, action: params.action,
      }), { id: "approval", agent: "holmes", action: "created" });
    }).immediate();
    assert.equal(readOwnerAgents(database, "alice").length, 1);
    assert.equal(executeSelect(database, schema, query => query.from("audit").count()), 1);
  } finally {
    database.close();
  }
});

test("constraint failure rolls back every Tinqer mutation in the native transaction", () => {
  const database = openDatabase();
  try {
    assert.throws(() => database.transaction(() => {
      insertAgent(database, { id: "holmes", owner: "alice", name: "Holmes", revision: 0 });
      executeInsert(database, schema, (query, params) => query.insertInto("audit").values({
        id: params.id, agent: params.agent, action: params.action,
      }), { id: "approval", agent: "absent-agent", action: "created" });
    }).immediate(), /FOREIGN KEY/);
    assert.equal(readOwnerAgents(database, "alice").length, 0);
    assert.equal(executeSelect(database, schema, query => query.from("audit").count()), 0);
  } finally {
    database.close();
  }
});

test("revision-qualified UPDATE detects a stale mutation without overwriting the current row", () => {
  const database = openDatabase();
  try {
    insertAgent(database, { id: "holmes", owner: "alice", name: "Holmes", revision: 0 });
    const update = (revision: number, name: string) => executeUpdate(database, schema, (query, params) =>
      query.update("agents").set(agent => ({ name: params.name, revision: agent.revision + 1 }))
        .where(agent => agent.id === params.id && agent.owner === params.owner && agent.revision === params.revision),
    { id: "holmes", owner: "alice", revision, name });
    assert.equal(update(0, "Approved name"), 1);
    assert.equal(update(0, "Stale name"), 0);
    assert.deepEqual(readOwnerAgents(database, "alice"), [
      { id: "holmes", owner: "alice", name: "Approved name", revision: 1 },
    ]);
  } finally {
    database.close();
  }
});

test("durability and writer exclusion use SQLite, not a JavaScript transaction emulation", scope => {
  const directory = mkdtempSync(join(process.cwd(), ".temp/architecture-data-"));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "management.sqlite");
  const first = openDatabase(path);
  const second = openDatabase(path);
  try {
    first.transaction(() => {
      insertAgent(first, { id: "holmes", owner: "alice", name: "Holmes", revision: 0 });
      assert.throws(() => second.transaction(() => {
        insertAgent(second, { id: "watson", owner: "alice", name: "Watson", revision: 0 });
      }).immediate(), /locked/);
      assert.equal(readOwnerAgents(second, "alice").length, 0);
    }).immediate();
    assert.equal(readOwnerAgents(second, "alice").length, 1);
  } finally {
    second.close();
    first.close();
  }
  const reopened = openDatabase(path);
  try {
    assert.deepEqual(readOwnerAgents(reopened, "alice").map(agent => agent.id), ["holmes"]);
  } finally {
    reopened.close();
  }
});
