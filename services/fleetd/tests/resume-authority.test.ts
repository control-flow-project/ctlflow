import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import type { Configuration } from '@ctlflow/fleetd-domain/model';
import type { AgentView, FleetView } from '@ctlflow/crossfire-contracts/schema/response';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';
import { loadBinding, saveBinding } from '@ctlflow/fleetd-storage/binding';
import { prepareEnrollment } from '../apps/daemon/src/enrollment.js';

for (const scenario of ['complete', 'unauthorized', 'missing', 'renamed', 'wrong-agent', 'wrong-account', 'wrong-owner', 'inactive', 'owner-inactive', 'wrong-fleet', 'wrong-fleet-key', 'wrong-fleet-owner', 'partial', 'duplicate', 'explicit-enrollment'] as const) {
  test('resume validates existing fleet authority without changing owner policy: ' + scenario, async scope => {
    const directory = mkdtempSync(join(tmpdir(), 'fleet-resume-authority-'));
    cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
    const ownerId = randomUUID(), agentId = randomUUID(), fleetId = randomUUID(), token = 'private-fixture-controller-token';
    const owner = { principalId: ownerId, matrixUserId: '@owner:test', kind: 'human' as const, displayName: 'Owner', ownerId, ownerMatrixId: '@owner:test' };
    const controller = { name: 'fixture-controller' };
    const fleet: FleetView = { fleetId, fleetKey: 'agreements', owner, controller, label: 'Agreements', revision: 0, createdAt: 1, updatedAt: 1,
      delivery: { fleetId, revision: 0, deliveryEnabled: true, connection: { status: 'online', lastSeenAt: 1 } }, canArchive: false, allowedActions: [] };
    const agent: AgentView = { agentId, matrixUserId: '@ada:test', name: 'ada', displayName: 'Ada', status: 'active', revision: 7, createdAt: 1,
      owner: { memberId: ownerId, matrixUserId: owner.matrixUserId, displayName: owner.displayName, status: 'active' },
      application: { appliedRevision: null, appliedStatus: null, nativeDisplayName: null, lastAttemptAt: null, lastSuccessAt: null, errorCode: null, errorMessage: null },
      activity: { status: 'offline', activeMs: 0, messagesDelivered: 0, lastSeenAt: null, activeRuns: [] }, nativeRuntime: null,
      deployment: { fleetId, fleetKey: fleet.fleetKey, label: fleet.label, controllerName: controller.name, reportedAt: 1, instanceKey: 'ada' },
      canRetire: false, allowedActions: [] };
    const calls: string[] = [], configuredPolicy = defaultCoordinationPolicy(owner.matrixUserId);
    const server = createServer(async (request, response) => {
      calls.push(request.method + ' ' + request.url);
      assert.equal(request.headers.authorization, scenario === 'explicit-enrollment' ? undefined : 'Bearer ' + token);
      for await (const part of request) assert(Buffer.isBuffer(part));
      const meta = { requestId: randomUUID() };
      let data: unknown, status = 200;
      if (scenario === 'unauthorized') status = 401;
      else if (request.method === 'GET' && request.url === '/api/fleets/' + fleetId) {
        const observed = structuredClone(fleet);
        if (scenario === 'wrong-fleet-key') observed.fleetKey = 'another-fleet';
        if (scenario === 'wrong-fleet-owner') observed.owner.matrixUserId = '@other:test';
        data = observed;
      }
      else if (request.method === 'GET' && request.url === '/api/fleets/' + fleetId + '/agents?page=1&pageSize=100') {
        const observed = structuredClone(agent);
        if (scenario === 'renamed') observed.name = 'someone-else';
        if (scenario === 'wrong-agent') observed.agentId = randomUUID();
        if (scenario === 'wrong-account') observed.matrixUserId = '@other:test';
        if (scenario === 'wrong-owner') observed.owner.matrixUserId = '@other:test';
        if (scenario === 'inactive') observed.status = 'suspended';
        if (scenario === 'owner-inactive') observed.owner.status = 'suspended';
        if (scenario === 'wrong-fleet') observed.deployment.fleetId = randomUUID();
        data = scenario === 'missing' ? [] : scenario === 'duplicate' ? [{ instanceKey: 'ada', agent: observed }, { instanceKey: 'ada', agent: observed }] : [{ instanceKey: 'ada', agent: observed }];
        Object.assign(meta, { page: 1, pageSize: 100, totalPages: scenario === 'partial' ? 2 : 1, totalItems: Array.isArray(data) ? data.length : 0 });
      } else status = 503;
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(status === 200 ? { data, meta } : { meta, error: { code: status === 401 ? 'unauthorized' : 'unavailable', message: 'Fixture refuses enrollment writes' } }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    cleanup(scope, () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
    const address = server.address(); assert(address && typeof address === 'object');
    const origin = 'http://127.0.0.1:' + address.port;
    const configuration: Configuration = { directory, digest: 'fixture', roster: { fleet: 'agreements', coordination: { adapter: 'crossfire', server: origin, owner: owner.matrixUserId },
      instances: [{ key: 'ada', name: 'ada', definition: 'analyst', workarea: 'agents/analyst/workarea/ada' }] },
      definitions: { analyst: { name: 'Analyst', runtime: 'codex', instructions: 'Fixture', options: {}, coordinationPolicy: configuredPolicy } } };
    const loaded = loadBinding(configuration); assert(loaded.ok);
    saveBinding(directory, { ...loaded.value, fleetId, controllerCredential: token, identities: [{ instanceKey: 'ada', name: 'ada', agentId,
      account: { user_id: agent.matrixUserId, access_token: 'private-fixture-agent-token', device_id: 'fixture' } }] });
    const before = readFileSync(join(directory, '.fleet/binding.json'), 'utf8');
    const approvals: string[] = [];
    const result = await prepareEnrollment(configuration, controller, scenario === 'explicit-enrollment' ? 'enroll' : 'resume', new AbortController().signal, approval => { approvals.push(approval.url); });
    assert.equal(result.ok, scenario === 'complete');
    if (!result.ok) assert.equal(result.error.code, scenario === 'unauthorized' ? 'unauthorized' : scenario === 'inactive' || scenario === 'owner-inactive' ? 'forbidden' : scenario === 'explicit-enrollment' ? 'unavailable' : 'conflict');
    assert.deepEqual(calls, scenario === 'explicit-enrollment' ? ['POST /api/enrollments/preflight'] : ['GET /api/fleets/' + fleetId,
      ...(['unauthorized', 'wrong-fleet-key', 'wrong-fleet-owner'].includes(scenario) ? [] : ['GET /api/fleets/' + fleetId + '/agents?page=1&pageSize=100'])]);
    assert.deepEqual(approvals, []);
    assert.equal(readFileSync(join(directory, '.fleet/binding.json'), 'utf8'), before);
    assert.equal(configuration.definitions.analyst!.coordinationPolicy, configuredPolicy);
  });
}
