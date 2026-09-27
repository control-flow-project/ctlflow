import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlMatrix, controlKey } from './control-auth.ts';
import { API, MatrixError, collect, readJson, writeJson, type Account, type Settings } from '../skills/conduit-chat/scripts/lib.ts';

test('control authentication survives revocation, shares concurrent renewal, and never replays ambiguous failures', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-control-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = controlKey(directory);
  assert.equal(controlKey(directory), key);
  if (process.platform !== 'win32') assert.equal(statSync(join(directory, 'control-key.json')).mode & 0o777, 0o600);
  const observer = '@coordinator:example.localhost';
  writeJson(join(directory, 'control-session.json'), { user_id: observer, device_id: 'CROSSFIRE_CONTROL', access_token: 'revoked' });
  let logins = 0, calls = 0;
  let activeToken = 'initial';
  let rejectLogin = false;
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === API + '/login') {
        logins++;
        const body = JSON.parse((await collect(request, 65536)).toString());
        assert.equal(body.type, 'm.login.token');
        assert.equal(body.device_id, 'CROSSFIRE_CONTROL');
        assert.equal(body.password, undefined);
        const [header, payload, signature] = body.token.split('.');
        assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'HS256', typ: 'JWT' });
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
        assert.equal(claims.sub, observer);
        assert(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 61);
        assert.equal(signature, createHmac('sha256', key).update(header + '.' + payload).digest('base64url'));
        if (rejectLogin) { response.writeHead(403); response.end('{"errcode":"M_FORBIDDEN"}'); return; }
        activeToken = 'session-' + logins;
        response.end(JSON.stringify({ user_id: observer, device_id: body.device_id, access_token: activeToken }));
        return;
      }
      calls++;
      if (request.headers.authorization !== 'Bearer ' + activeToken || request.url === '/always-revoked') {
        response.writeHead(401); response.end('{"errcode":"M_UNKNOWN_TOKEN"}');
      } else if (request.url === '/forbidden') {
        response.writeHead(403); response.end('{"errcode":"M_FORBIDDEN"}');
      } else if (request.url === '/failed') {
        response.writeHead(500); response.end('{"errcode":"M_UNKNOWN"}');
      } else if (request.url === '/disconnected') response.destroy();
      else response.end('{"ok":true}');
    })().catch(error => { response.destroy(error); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert(address && typeof address === 'object');
  const settings = { homeserver: `http://127.0.0.1:${address.port}`, observer } as Settings;
  const client = new ControlMatrix(settings, directory);
  await Promise.all(Array.from({ length: 12 }, () => client.get('/success')));
  assert.equal(logins, 1);
  assert.equal(readJson<Account>(join(directory, 'control-session.json')).access_token, activeToken);
  activeToken = 'revoked-again';
  await Promise.all(Array.from({ length: 12 }, () => client.post('/success', { change: true })));
  assert.equal(logins, 2);
  for (const path of ['/forbidden', '/failed', '/disconnected']) {
    const before = calls;
    await assert.rejects(client.post(path, {}));
    assert.equal(calls, before + 1);
    assert.equal(logins, 2);
  }
  await assert.rejects(client.get('/always-revoked'), error => error instanceof MatrixError && error.status === 401);
  assert.equal(logins, 3, 'one retry per operation, even if the replacement is also rejected');
  activeToken = 'revoked-once-more'; rejectLogin = true;
  await assert.rejects(client.get('/success'), error => error instanceof MatrixError && error.status === 403);
  assert.equal(logins, 4);
  rejectLogin = false;
  await client.get('/success');
  assert.equal(logins, 5, 'a failed renewal must not poison subsequent attempts');
  const restarted = new ControlMatrix(settings, directory);
  await restarted.get('/success');
  assert.equal(logins, 5, 'a valid saved control session is reused');
});
