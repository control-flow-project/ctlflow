import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { createRuntimeRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/runtime/index';
import { databaseValid } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { value } from '../../node/tests/support/application.js';

export function populatePerformanceHistory(file: string, agentId: string) {
  const database = new Database(file, { fileMustExist: true });
  try {
    database.pragma('foreign_keys=ON'); database.pragma('synchronous=FULL');
    const repositories = createRepositories(database), runtime = createRuntimeRepository(database);
    const binding = value(repositories.fleetInstance.findByAgent(agentId)); assert(binding);
    const fleet = value(repositories.fleet.find(binding)); assert(fleet);
    const credential = value(repositories.fleetCredential.forFleet(fleet.id)).find(row => row.revokedAt === null); assert(credential);
    const identity = { ownerId: binding.ownerId, fleetKey: binding.fleetKey, fleetId: fleet.id, credentialId: credential.id };
    const applied = value(repositories.principalApplication.find({ principalId: agentId })); assert(applied);
    const now = Date.now(), started = now - 2 * 86400000, connectionId = randomUUID();
    database.transaction(() => {
      for (let index = 0; index < 50; index++) {
        const id = index === 0 ? agentId : randomUUID();
        if (index !== 0) {
          value(repositories.principal.insert({ id, matrixUserId: '@performance-' + index + ':architecture.localhost', kind: 'agent', status: 'active', revision: 0, createdAt: started }));
          value(repositories.agent.insert({ principalId: id, principalKind: 'agent', ownerId: identity.ownerId, wakeMode: 'selected' }));
          value(repositories.agentName.insert({ name: 'performance-' + index, agentId: id, requestId: null, instanceKey: null }));
          value(repositories.principalRole.insert({ principalId: id, principalKind: 'agent', roleCode: 'agent', assignedByMemberId: identity.ownerId, assignedAt: started }));
          value(repositories.principalApplication.insert({ ...applied, principalId: id, nextCheckAt: now + 86400000, errorCode: null, errorMessage: null }));
          value(repositories.fleetInstance.insert({ ownerId: identity.ownerId, fleetKey: identity.fleetKey, instanceKey: 'performance-' + index, agentId: id, retiredAt: null }));
        }
        for (let history = 0; history < 1000; history++) {
          const runId = randomUUID(), at = started + history;
          value(repositories.listenerRun.insert({ id: runId, agentId: id, release: 'performance-history',
            controller: { fleetId: identity.fleetId, connectionId, credentialId: identity.credentialId }, startedAt: at, lastSeenAt: at,
            activeMs: 0, messagesDelivered: 0, stoppedAt: at, disconnectRequestedAt: null }));
          value(runtime.saveObservation(id, { runId, sessionId: 'saved-context', roomId: null, runtime: 'codex', state: 'sleeping', observedAt: at,
            historyMode: 'shared', maxInputBytes: 65536, errorMessage: null, lastActivityAt: at, historyAvailable: true, settings: [] }));
        }
      }
    })();
    assert.equal(databaseValid(database), true, 'The populated fixture preserves database integrity and every relationship');
    return {
      agents: executeSelect(database, schema, query => query.from('agent').count()),
      listenerRuns: executeSelect(database, schema, query => query.from('listener_run').count()),
      runtimeObservations: executeSelect(database, schema, query => query.from('runtime_observation').count()),
    };
  } finally { database.close(); }
}
