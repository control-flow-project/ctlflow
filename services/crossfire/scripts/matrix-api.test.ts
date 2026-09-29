import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { matrix } from '@crossfire/adapter-matrix/http';
import { operations, nativeRequest, selectOperation, executeOperation, requestBody } from '@crossfire/adapter-matrix/commands';
import { kebab } from '@crossfire/adapter-matrix/schema';
import { encodeOutput, outputBytes } from '@crossfire/contracts/limits';
import { uploadStream, saveStream } from '@crossfire/adapter-matrix/files';
import { matrixFixture, temporary, ROOM } from './test-support/listener.js';
import { buildClient } from './build-client.js';

before(() => buildClient(process.cwd()));

test('all 157 official operations have one mechanically derived spelling and exact native path', () => {
  assert.equal(operations.length, 157);
  assert.equal(new Set(operations.map(operation => operation.command)).size, 157);
  for (const operation of operations) {
    assert.equal(operation.command, kebab(operation.id));
    assert.match(operation.command, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert(operation.path.startsWith('/_matrix/') || operation.path.startsWith('/.well-known/'));
    const parameters = Object.fromEntries(operation.parameters.filter(parameter => parameter.required).map(parameter => [kebab(parameter.name),
      String(parameter.values?.[0] ?? (parameter.type === 'integer' || parameter.type === 'number' ? 1 : parameter.type === 'object' ? '{}' : parameter.type === 'boolean' ? true : 'opaque value/#'))]));
    const request = nativeRequest(operation, parameters);
    assert(!request.path.includes('{'));
    assert(!request.path.includes('opaque value'));
    assert.equal(selectOperation(operation.command), operation);
  }
  assert.equal(kebab('getAccount3PIDs'), 'get-account3-pids');
  assert.equal(kebab('next_batch'), 'next-batch');
  assert.throws(() => selectOperation('getRoomEvents'), /Unknown/);
  assert.equal(selectOperation('get-url-preview-authed').access, 'unsupported');
});

test('native pagination tokens, repeated parameters, and field casing are lossless', () => {
  const request = nativeRequest(selectOperation('get-room-events'), { 'room-id': '!room/a', from: 'opaque+/= token', dir: 'b', limit: '3' });
  assert.equal(request.path, '/_matrix/client/v3/rooms/!room%2Fa/messages?from=opaque%2B%2F%3D+token&dir=b&limit=3');
  const members = nativeRequest(selectOperation('get-members-by-room'), { 'room-id': ROOM, 'not-membership': 'leave' });
  assert(members.path.includes('not_membership=leave'));
  const join = nativeRequest(selectOperation('join-room'), { 'room-id-or-alias': '#x:test.localhost', via: ['one', 'two'] });
  assert.equal(new URL(join.path, 'http://localhost').searchParams.getAll('via').length, 2);
  for (const limit of ['0', '101', 'Infinity', 'NaN', '1.5', '9007199254740993']) {
    assert.throws(() => nativeRequest(selectOperation('get-room-events'), { 'room-id': ROOM, dir: 'b', limit }));
  }
  assert.throws(() => nativeRequest(selectOperation('get-room-events'), { 'room-id': '..', dir: 'b' }));
  assert.throws(() => nativeRequest(selectOperation('get-room-events'), { 'room-id': ROOM, dir: 'sideways' }));
});

test('context bounds cover the entire output and never truncate native continuations', () => {
  assert.equal(outputBytes(undefined), 65536);
  assert.equal(outputBytes('98304'), 98304);
  for (const value of ['98305', 'Infinity', '1.1', '-1', '0', ' 64000']) assert.throws(() => outputBytes(value));
  const result = { chunk: ['😀'.repeat(18000)], end: 'do-not-advance' };
  assert.throws(() => encodeOutput(result), /No read position was advanced/);
  assert.deepEqual(JSON.parse(encodeOutput(result, 98304).toString()), result);
});

test('native policy rejects privileged operations, foreign identities, remote routes, and unused flags before mutation', async context => {
  const fixture = await matrixFixture(context, temporary(context));
  const client = matrix({base: fixture.settings.homeserver, token: fixture.account.access_token});
  for (const operation of operations.filter(operation => operation.access !== 'agent')) {
    await assert.rejects(executeOperation(client, fixture.settings, fixture.account, operation, {}), /not an enabled/);
  }
  assert.equal(fixture.requests.length, 0);
  for (const [command, args] of [
    ['set-display-name', { 'user-id': fixture.settings.owner, body: '{"displayname":"wrong"}' }],
    ['get-account-data', { 'user-id': fixture.settings.owner, type: 'm.direct' }],
    ['join-room', { 'room-id-or-alias': '#room:elsewhere', body: '{}' }],
    ['join-room', { 'room-id-or-alias': ROOM, via: 'elsewhere', body: '{}' }],
    ['get-joined-rooms', { markdown: 'ignored' }],
    ['send-message', { 'room-id': ROOM, 'event-type': 'm.room.message', body: '{}' }],
  ] as const) await assert.rejects(executeOperation(client, fixture.settings, fixture.account, selectOperation(command), args));
  assert(!fixture.requests.some(request => request.method !== 'GET'));
  fixture.missingObserver.add(ROOM);
  const result = await executeOperation(client, fixture.settings, fixture.account, selectOperation('get-room-events'), { 'room-id': ROOM, dir: 'b' });
  assert.deepEqual((result as { chunk: unknown[] }).chunk, []);
  assert(!fixture.requests.some(request => request.path.endsWith('/joined_members')));
});

test('native bodies support Markdown once and reject ambiguous, excessive or malformed inputs', context => {
  const directory = temporary(context), file = join(directory, 'message.md');
  writeFileSync(file, '**hello**');
  assert.deepEqual(requestBody({ 'markdown-file': file }), requestBody({ markdown: '**hello**' }));
  assert.deepEqual(requestBody({ markdown: '**hello**' }), { msgtype: 'm.text', body: '**hello**' });
  assert.throws(() => requestBody({ markdown: 'x', body: '{}' }), /one request/);
  assert.throws(() => requestBody({ body: '[]' }), /object/);
  writeFileSync(file, 'x'.repeat(1024 * 1024 + 1));
  assert.throws(() => requestBody({ 'body-file': file }), /limit/);
});

test('binary streams are bounded, exclusive, hashed and remove partial files', async context => {
  const directory = temporary(context), original = join(directory, 'original.bin'), received = join(directory, 'received.bin');
  const bytes = Buffer.from(Array.from({ length: 131113 }, (_, index) => index % 256));
  writeFileSync(original, bytes);
  const report = await saveStream(uploadStream(original, bytes.length), received, bytes.length);
  assert.equal(report.bytes, bytes.length);
  assert.deepEqual(readFileSync(received), bytes);
  assert.equal(statSync(received).mode & 0o777, 0o600);
  assert.throws(() => uploadStream(original, bytes.length - 1), /limit/);
  await assert.rejects(saveStream(Readable.from([Buffer.from('changed')]), received, bytes.length), /EEXIST/);
  assert.deepEqual(readFileSync(received), bytes);
  const partial = join(directory, 'partial');
  await assert.rejects(saveStream(Readable.from([bytes]), partial, 100), /limit/);
  assert(!existsSync(partial));
});

test('CLI exposes the native manifest and rejects every superseded top-level command', async () => {
  const execute = promisify(execFile), script = join(process.cwd(), 'dist/crossfire-client.mjs');
  const result = await execute(process.execPath, [script, 'matrix', 'get-room-events', '--help']);
  assert.equal(JSON.parse(result.stdout).id, 'getRoomEvents');
  for (const command of ['init', 'read', 'listen', 'send', 'history', 'rooms', 'who', 'upload', 'download']) {
    await assert.rejects(execute(process.execPath, [script, command]), /Use agent, room or matrix/);
  }
});

test('large JSON transport fails independently of the smaller context budget', async context => {
  const server = createServer((_request, response) => response.end(JSON.stringify({ value: 'x'.repeat(1024 * 1024) })));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  context.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert(address && typeof address === 'object');
  await assert.rejects(matrix({base: 'http://127.0.0.1:' + address.port}).get('/probe'), /size bound/);
});
