import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { terminalPointer } from '../apps/cli/src/attachment.js';
import { createDaemonClient } from '@ctlflow/fleet-daemon-client/client';
import { success } from '@ctlflow/crossfire-kernel/result';

test('fleet terminal pointers dispatch only through the runtime adapter and the private API', async scope => {
  const socket = join(mkdtempSync(join(tmpdir(), 'fleet-pointer-')), 'daemon.sock'), fleetId = randomUUID();
  const descriptor = { runtime: 'fixture', sessionId: 'native-non-uuid-session', workspace: '/remote/workspace', connection: { nativeBinding: 'fixture-private-path' } };
  const server = createServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/api/fleets/' + fleetId + '/agents/analyst/attachment');
    assert.equal(request.headers.host, 'localhost');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: descriptor, meta: { requestId: randomUUID() } }));
  });
  server.listen(socket); await once(server, 'listening');
  cleanup(scope, () => new Promise<void>(resolve => server.close(() => resolve())));
  const client = createDaemonClient(socket), received: unknown[] = [];
  const adapters = { fixture: { command: (attachment: typeof descriptor) => { received.push(attachment); return success('native-fixture --existing-session'); } } };
  const local = await terminalPointer(client, fleetId, 'analyst', adapters);
  assert(local.ok); assert.equal(local.value.command, 'native-fixture --existing-session'); assert.deepEqual(received, [descriptor]);
  assert(!JSON.stringify(local.value).includes('fixture-private-path'));
  const remote = await terminalPointer(client, fleetId, 'analyst', adapters, 'operator@office');
  assert(remote.ok); assert(remote.value.command.includes('StrictHostKeyChecking=yes')); assert(remote.value.command.includes('operator@office'));
  assert.equal((await terminalPointer(client, fleetId, 'analyst', {})).ok, false);
  assert.equal((await terminalPointer(client, fleetId, 'analyst', adapters, '-oUnsafe=yes')).ok, false);
  descriptor.runtime = 'constructor';
  const unknown = await terminalPointer(client, fleetId, 'analyst', {});
  assert(!unknown.ok); assert.equal(unknown.error.message, 'No terminal adapter for runtime: constructor');
});
