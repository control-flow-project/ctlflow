import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { json } from '@ctlflow/crossfire-contracts/matrix';
import { endpoint } from '@ctlflow/crossfire-contracts/origin';
import { collect, nativeJson, nativeOpen } from '@ctlflow/crossfire-adapter-matrix/http';
import { MAX_JSON_BYTES } from "@ctlflow/crossfire-contracts/limits";

async function fixture(scope: TestContext, listener: RequestListener): Promise<string> {
  const server = createServer(listener);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  cleanup(scope, async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return "http://127.0.0.1:" + address.port;
}

test("native transport accepts only finite plain JSON without executing accessors", () => {
  assert.equal(json({ nested: [null, false, 3, "value"] }), true);
  assert.equal(json(Object.assign(Object.create(null) as object, { value: true })), true);
  let accessed = false;
  const accessor = { get value() { accessed = true; return true; } };
  const circular: { value?: unknown } = {};
  circular.value = circular;
  for (const invalid of [new Date(), new Map(), Infinity, NaN, undefined, () => true, accessor, circular, { value: undefined }, { [Symbol("key")]: true }]) {
    assert.equal(json(invalid), false);
  }
  assert.equal(accessed, false);
});

test("native paths cannot change origin or normalize whitespace into another request", async scope => {
  let requested = 0;
  const origin = await fixture(scope, (request, response) => {
    requested++;
    assert.equal(request.headers.authorization, "Bearer fixture-token");
    assert.equal(request.url, "/_matrix/client/v3/rooms/!opaque%2Froom?limit=1");
    response.end('{"ok":true}');
  });
  const client = { base: origin, token: "fixture-token" };
  for (const path of ["//attacker.invalid", "/\\attacker.invalid", "/path#fragment", "/bad path", "/bad\npath", "/bad\u0000path"]) {
    const result = await nativeOpen(client, "GET", path);
    assert(!result.ok && result.error.code === "invalid");
  }
  for (const unsafe of ["http://example.org", origin + "/path", origin + "?query=true", "https://user:password@example.org", "ftp://example.org"]) {
    assert.equal(endpoint(unsafe).ok, false);
  }
  const result = await nativeJson(client, "GET", "/_matrix/client/v3/rooms/!opaque%2Froom?limit=1");
  assert(result.ok);
  assert.deepEqual(result.value.body, { ok: true });
  assert.equal(requested, 1);
});

test("native redirects never forward an agent credential to another endpoint", async scope => {
  let escaped = 0;
  const other = await fixture(scope, (_request, response) => { escaped++; response.end("{}"); });
  const origin = await fixture(scope, (_request, response) => {
    response.writeHead(307, { Location: other + "/stolen" });
    response.end();
  });
  assert.equal((await nativeJson({ base: origin, token: "fixture-token" }, "GET", "/redirect")).ok, false);
  assert.equal(escaped, 0);
});

test("native response limits cover streaming bytes and slow bodies", async scope => {
  const origin = await fixture(scope, (request, response) => {
    if (request.url === "/large") response.end('"' + "x".repeat(MAX_JSON_BYTES) + '"');
    else {
      response.write("{");
    }
  });
  const client = { base: origin, timeoutMs: 100 };
  assert.equal((await nativeJson(client, "GET", "/large")).ok, false);
  const started = performance.now();
  assert.equal((await nativeJson(client, "GET", "/slow")).ok, false);
  assert(performance.now() - started < 900);
  async function* chunks() { yield Buffer.from("123"); yield Buffer.from("45"); }
  assert.equal((await collect(chunks(), 5)).toString(), "12345");
  await assert.rejects(collect(chunks(), 4), /byte limit/u);
  for (const invalid of [NaN, Infinity, -1, 0, 0.5]) await assert.rejects(collect(chunks(), invalid), /Invalid finite/u);
});
