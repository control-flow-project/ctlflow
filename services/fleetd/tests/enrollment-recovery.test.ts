import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { loadConfiguration } from '@ctlflow/fleetd-storage/configuration';
import { loadBinding, saveBinding } from '@ctlflow/fleetd-storage/binding';
import { prepareEnrollment } from '../apps/daemon/src/enrollment.js';

for (const status of ['expired', 'rejected', 'pending', 'unauthorized'] as const) {
  test('explicit fleet restart handles saved ' + status + ' enrollment without silently retrying owner rejection', async scope => {
    const calls: string[] = [];
    const server = createServer(async (request, response) => {
      calls.push(request.method + ' ' + request.url);
      for await (const part of request) assert(Buffer.isBuffer(part));
      let data: unknown;
      if (request.url?.endsWith('/exchange') && status !== 'unauthorized') {
        data = { status, ownerMatrixId: '@owner:test', fleet: null, instances: [] };
      } else if (request.url === '/api/enrollments/preflight') {
        data = { available: true, instances: 1 };
      }
      const meta = { requestId: randomUUID() };
      response.writeHead(data ? 200 : status === 'unauthorized' ? 401 : 503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data ? { data, meta } : { meta,
        error: { code: status === 'unauthorized' ? 'unauthorized' : 'unavailable', message: 'Deterministic fixture stop' } }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    cleanup(scope, () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
    const address = server.address(); assert(address && typeof address === 'object');
    const directory = mkdtempSync(join(tmpdir(), 'fleet-review-recovery-')), role = join(directory, 'agents/analyst');
    cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(role, { recursive: true, mode: 0o700 });
    writeFileSync(join(role, 'agent.toml'), 'name = "Analyst"\nruntime = "codex"\n[runtime_options]\nmodel = "fixture"\n[coordination_options]\nwake_mode = "owner-agents"\npermissions = ["room.agent.invite"]\n', { mode: 0o600 });
    writeFileSync(join(role, 'AGENTS.md'), 'Role fixture.', { mode: 0o600 });
    const origin = 'http://127.0.0.1:' + address.port;
    writeFileSync(join(directory, 'runtime.toml'), 'fleet = "agreements"\n[coordination]\nadapter = "crossfire"\nserver = "' + origin + '"\nowner = "@owner:test"\n'
      + '[[instances]]\nkey = "ada"\nname = "ada"\ndefinition = "analyst"\nworkarea = "agents/analyst/workarea/ada"\n', { mode: 0o600 });
    const configuration = loadConfiguration(directory); if (!configuration.ok) assert.fail(configuration.error.message);
    const controller = { name: 'fixture-controller' }, loaded = loadBinding(configuration.value); assert(loaded.ok);
    const input = { ownerMatrixId: '@owner:test', fleetKey: 'agreements', controller, instances: [
      { instanceKey: 'ada', name: 'ada', coordinationPolicy: configuration.value.definitions.analyst!.coordinationPolicy },
    ] };
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const enrollmentId = randomUUID();
    saveBinding(directory, { ...loaded.value, request: { enrollmentId, claimSecret: randomBytes(32).toString('base64url'), digest } });
    const notices: string[] = [];
    const prepared = await prepareEnrollment(configuration.value, controller, new AbortController().signal, approval => { notices.push(approval.url); });
    assert(!prepared.ok); assert.equal(prepared.error.code, status === 'unauthorized' ? 'unauthorized' : 'unavailable');
    const final = loadBinding(configuration.value); assert(final.ok); assert(final.value.request);
    const renewed = status === 'expired' || status === 'rejected';
    assert.equal(final.value.request.enrollmentId !== enrollmentId, renewed);
    assert.deepEqual(calls, ['POST /api/enrollments/' + enrollmentId + '/exchange',
      ...(renewed ? ['POST /api/enrollments/preflight'] : []), ...(status === 'unauthorized' ? [] : ['POST /api/enrollments'])]);
    assert.deepEqual(notices, []);
  });
}
