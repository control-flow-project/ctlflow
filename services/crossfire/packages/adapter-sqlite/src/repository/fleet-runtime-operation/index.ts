import type Database from 'better-sqlite3';
import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { success } from '@crossfire/kernel/result';
import type { RuntimeOperation, RuntimeOperationRepository } from '@crossfire/domain/fleet/runtime-types';
import { schema, type Tables } from '../../schema/tables.js';
import { stored } from '../stored.js';
import { page } from '../directory/index.js';

function map(row: Tables['fleet_runtime_operation']): RuntimeOperation {
  return { operationId: row.id, fleetId: row.fleet_id, agentId: row.agent_id, authorPrincipalId: row.author_principal_id,
    action: row.action, expectedRevision: row.expected_revision, status: row.status, createdAt: row.created_at,
    completedAt: row.completed_at, errorMessage: row.error_message, connectionId: row.connection_id, credentialId: row.credential_id };
}
export function createFleetRuntimeOperationRepository(database: Database.Database): RuntimeOperationRepository {
  return {
    find(operationId) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('fleet_runtime_operation').where(row => row.id === params.operationId).firstOrDefault(), { operationId });
      return success(row ? map(row) : null);
    }); },
    pending(fleetId) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('fleet_runtime_operation')
        .where(row => row.fleet_id === params.fleetId && (row.status === 'pending' || row.status === 'running')).firstOrDefault(), { fleetId });
      return success(row ? map(row) : null);
    }); },
    page(fleetId, input) { return stored(() => {
      const params = { fleetId, offset: (input.page - 1) * input.pageSize, limit: input.pageSize };
      const total = executeSelect(database, schema, (query, params) => query.from('fleet_runtime_operation').where(row => row.fleet_id === params.fleetId).count(), params);
      const rows = executeSelect(database, schema, (query, params) => query.from('fleet_runtime_operation').where(row => row.fleet_id === params.fleetId)
        .orderByDescending(row => row.created_at).thenByDescending(row => row.id).skip(params.offset).take(params.limit), params);
      return success(page(rows.map(map), total, input));
    }); },
    insert(operation) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('fleet_runtime_operation').values({ id: params.operationId, fleet_id: params.fleetId,
        agent_id: params.agentId, author_principal_id: params.authorPrincipalId, action: params.action, expected_revision: params.expectedRevision,
        status: params.status, created_at: params.createdAt, completed_at: params.completedAt, error_message: params.errorMessage,
        connection_id: params.connectionId, credential_id: params.credentialId }), operation);
      return success(undefined);
    }); },
    update(operation) { return stored(() => {
      executeUpdate(database, schema, (query, params) => query.update('fleet_runtime_operation').set({ status: params.status,
        completed_at: params.completedAt, error_message: params.errorMessage, connection_id: params.connectionId, credential_id: params.credentialId })
        .where(row => row.id === params.operationId), operation);
      return success(undefined);
    }); },
  };
}
