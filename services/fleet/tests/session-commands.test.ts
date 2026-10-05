import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cleanup } from '@crossfire/test-support/cleanup';
import { operations } from '@fleetd/contracts/api';

test('CLI fleet and individual start resume by default; only --fresh-history selects reset', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-session-cli-')), root = join(directory, 'controller'), home = join(directory, 'home');
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(root, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  const fleetId = randomUUID(), inputs: { operationId: string; action: string; target: { kind: string; instanceKey?: string } }[] = [];
  let loseResponse = false;
  const fleet = { fleetId, fleetKey: 'test', directory: '/private/fixture', label: 'Test', revision: 0, controller: { name: 'test' }, phase: 'stopped',
    connection: { connected: true, deliveryEnabled: false, revision: 0, error: null }, error: null,
    instances: [{ instance: { key: 'one', name: 'one', definition: 'analyst', workarea: 'agents/analyst/workarea/one' }, phase: 'stopped',
      listenerActive: false, desiredActive: false, lastActivityAt: null, historyAvailable: null,
      sessionId: null, error: null, startedAt: null }] };
  const server = createServer(async (request, response) => {
    let data: unknown, meta: object = { requestId: randomUUID() }, status = 200;
    if (request.method === 'GET') { data = [fleet]; meta = { ...meta, page: 1, pageSize: 100, totalItems: 1, totalPages: 1 }; }
    else {
      const bytes: Buffer[] = []; for await (const chunk of request) bytes.push(Buffer.from(chunk));
      const parsed = operations.operate.input(JSON.parse(Buffer.concat(bytes).toString())); assert(parsed.ok);
      inputs.push(parsed.value); status = 202;
      if (loseResponse) { response.destroy(); return; }
      data = { ...parsed.value, status: 'succeeded', createdAt: 1, completedAt: 2, approval: null, errors: [] };
    }
    response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data, meta }));
  });
  server.listen(join(root, 'fleetd.sock')); await once(server, 'listening');
  cleanup(scope, () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const entry = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
  const cli = (...args: string[]) => promisify(execFile)(process.execPath, [entry, '--root', root, ...args],
    { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(directory, 'config') }, timeout: 15000 });
  await cli('start', 'test'); await cli('agent', 'start', 'test', 'one');
  await cli('start', 'test', '--fresh-history'); await cli('agent', 'start', 'test', 'one', '--fresh-history', '--operation-id', randomUUID());
  const stopFleetId = randomUUID(), stopAgentId = randomUUID();
  await cli('stop', 'test', '--operation-id', stopFleetId); await cli('agent', 'stop', 'test', 'one', '--operation-id', stopAgentId);
  assert.deepEqual(inputs.map(input => [input.action, input.target.kind, input.target.instanceKey ?? null]),
    [['start', 'fleet', null], ['start', 'agent', 'one'], ['reset', 'fleet', null], ['reset', 'agent', 'one'], ['stop', 'fleet', null], ['stop', 'agent', 'one']]);
  assert.deepEqual(inputs.slice(-2).map(input => input.operationId), [stopFleetId, stopAgentId]);
  await assert.rejects(cli('stop', 'test', '--fresh-history'), /Option is not valid/u);
  await assert.rejects(cli('agent', 'reset', 'test', 'one'), /fleet agent start/u);
  assert.equal(inputs.length, 6, 'Invalid commands cannot submit a lifecycle action');
  loseResponse = true;
  const retryId = randomUUID();
  await assert.rejects(cli('start', 'test', '--fresh-history', '--operation-id', retryId), (error: unknown) =>
    error instanceof Error && 'stdout' in error && typeof error.stdout === 'string' && error.stdout.includes(retryId),
  'An uncertain submission must expose its stable identity before the remote response');
  assert.equal(inputs.length, 7);
});
