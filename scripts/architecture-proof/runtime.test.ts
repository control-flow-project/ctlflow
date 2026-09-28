import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { request } from "./native-http.js";
import { insertAgent, openDatabase, readAgent, readOwnerAgents } from "./data-fixture.js";

type Result<Value> = { ok: true; value: Value } | { ok: false; error: "invalid-name" };

function validateName(value: unknown): Result<{ name: string }> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 1 || !("name" in value)
    || typeof value.name !== "string" || value.name.length === 0 || value.name.length > 64) {
    return { ok: false, error: "invalid-name" };
  }
  return { ok: true, value: { name: value.name } };
}

test("functional HTTP/client/Tinqer round-trip uses one strict boundary contract", async context => {
  const database = openDatabase();
  context.after(() => database.close());
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const raw of incoming) {
      assert(Buffer.isBuffer(raw));
      size += raw.byteLength;
      if (size > 1024) { outgoing.writeHead(413).end("{}"); return; }
      chunks.push(raw);
    }
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { outgoing.writeHead(400).end("{}"); return; }
    const result = validateName(decoded);
    if (!result.ok) { outgoing.writeHead(400).end(JSON.stringify(result)); return; }
    const stored = database.transaction(() => {
      const id = randomUUID();
      insertAgent(database, { id, owner: "fixture-owner", name: result.value.name, revision: 0 });
      const row = readAgent(database, "fixture-owner", id);
      assert(row);
      return { name: row.name };
    }).immediate();
    const response: Result<{ name: string }> = { ok: true, value: stored };
    outgoing.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(response));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
  const accepted = await request(base, "POST", "/fixture", { name: "Holmes" });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body, { ok: true, value: { name: "Holmes" } });
  for (const input of [null, [], {}, { name: 1 }, { name: "" }, { name: "x".repeat(65) }, { name: "Holmes", owner: "forged" }]) {
    const denied = await request(base, "POST", "/fixture", input);
    assert.equal(denied.status, 400);
    assert.deepEqual(denied.body, { ok: false, error: "invalid-name" });
  }
  const oversized = await request(base, "POST", "/fixture", { name: "x".repeat(2048) });
  assert.equal(oversized.status, 413);
  assert.equal(readOwnerAgents(database, "fixture-owner").length, 1);
});
