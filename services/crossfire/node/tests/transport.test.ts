import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import { connect } from 'node:http2';
import { Readable } from 'node:stream';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import test, { type TestContext } from "node:test";
import { json } from '@ctlflow/crossfire-kernel/json';
import { endpoint } from '@ctlflow/crossfire-contracts/origin';
import { nativeJson, nativeOpen } from '@ctlflow/crossfire-adapter-matrix/http';
import { collect } from '@ctlflow/crossfire-kernel/collect';
import { MAX_JSON_BYTES } from "@ctlflow/crossfire-contracts/limits";
import { secureHttp2Router } from '@ctlflow/crossfire-test-support/tls';

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

test('native HTTPS uses HTTP/1.1 even when the endpoint offers working HTTP/2', { timeout: 10_000 }, async scope => {
  const versions: string[] = [];
  let sessions = 0;
  const { server, origin } = await secureHttp2Router(scope, (request, response) => {
    versions.push(request.httpVersion);
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => response.end(JSON.stringify({ method: request.method, path: request.url,
      authorization: request.headers.authorization ?? null, contentType: request.headers['content-type'] ?? null,
      body: Buffer.concat(chunks).toString('utf8') })));
  });
  server.on('session', () => sessions++);
  const control = connect(origin);
  cleanup(scope, () => control.destroy());
  await once(control, 'connect');
  assert.equal(control.alpnProtocol, 'h2');
  const probe = control.request({ ':path': '/probe' }), ended = once(probe, 'end');
  probe.resume(); probe.end(); await ended;
  const closed = once(control, 'close'); control.close(); await closed;
  assert.equal(sessions, 1);

  const client = { base: origin, token: 'fixture-token' };
  const jsonResult = await nativeJson(client, 'PUT', '/json?limit=1', { message: 'verified TLS' });
  assert(jsonResult.ok);
  assert.deepEqual(jsonResult.value.body, { method: 'PUT', path: '/json?limit=1', authorization: 'Bearer fixture-token',
    contentType: 'application/json', body: '{"message":"verified TLS"}' });
  const opened = await nativeOpen(client, 'POST', '/upload', Readable.from([Buffer.from('first\n'), Buffer.from('second ✓')]), 'text/plain');
  assert(opened.ok);
  assert.deepEqual(await opened.value.json(), { method: 'POST', path: '/upload', authorization: 'Bearer fixture-token',
    contentType: 'text/plain', body: 'first\nsecond ✓' });
  assert.deepEqual(versions, ['2.0', '1.1', '1.1']);
  assert.equal(sessions, 1, 'Native requests never created another HTTP/2 session');
});

test('native HTTPS refuses an untrusted certificate without delivering credentials', { timeout: 10_000 }, async scope => {
  const authorities = getCACertificates('default');
  let requests = 0;
  const { origin } = await secureHttp2Router(scope, (_request, response) => { requests++; response.end('{}'); });
  setDefaultCACertificates(authorities);
  const result = await nativeJson({ base: origin, token: 'fixture-token' }, 'GET', '/protected');
  assert(!result.ok && result.error.code === 'native');
  assert.equal(requests, 0);
});

test('native HTTPS aborts an in-flight request without retrying and accepts the next request', { timeout: 10_000 }, async scope => {
  const accepted = Promise.withResolvers<void>(), disconnected = Promise.withResolvers<void>();
  const paths: string[] = [];
  const { origin } = await secureHttp2Router(scope, (request, response) => {
    assert.equal(request.httpVersion, '1.1');
    paths.push(request.url ?? '');
    if (request.url === '/held') {
      response.once('close', () => disconnected.resolve());
      accepted.resolve();
    } else response.end('{"ready":true}');
  });
  const controller = new AbortController(), client = { base: origin, signal: controller.signal };
  const pending = nativeJson(client, 'GET', '/held');
  await accepted.promise;
  controller.abort();
  const cancelled = await pending;
  assert(!cancelled.ok && cancelled.error.code === 'native');
  await disconnected.promise;
  const next = await nativeJson({ base: origin }, 'GET', '/after');
  assert(next.ok);
  assert.deepEqual(next.value.body, { ready: true });
  assert.deepEqual(paths, ['/held', '/after']);
});

test('native HTTPS survives a connection lost during the response and reconnects without replaying it', { timeout: 10_000 }, async scope => {
  let interrupted = 0, completed = 0;
  const { origin } = await secureHttp2Router(scope, (request, response) => {
    assert.equal(request.httpVersion, '1.1');
    if (request.url === '/drop') {
      interrupted++;
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' });
      response.write('{"unfinished":', () => response.socket?.destroy());
    } else { completed++; response.end('{"ready":true}'); }
  });
  const failed = await nativeJson({ base: origin }, 'GET', '/drop');
  assert(!failed.ok && failed.error.code === 'native');
  const next = await nativeJson({ base: origin }, 'GET', '/after');
  assert(next.ok);
  assert.deepEqual(next.value.body, { ready: true });
  assert.equal(interrupted, 1);
  assert.equal(completed, 1);
});
