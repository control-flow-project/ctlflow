import type Database from 'better-sqlite3';
import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { success } from '@ctlflow/crossfire-kernel/result';
import type { NativeStop, NativeStopRepository } from '@ctlflow/crossfire-domain/fleet/native-stop';
import { schema, type Tables } from '../../schema/tables.js';
import { stored } from '../stored.js';

function mapStop(row: Tables['fleet_native_stop']): NativeStop {
  return { agentId: row.agent_id, receiptId: row.receipt_id, sequence: row.sequence, fleetId: row.fleet_id,
    runId: row.run_id, connectionId: row.connection_id, credentialId: row.credential_id,
    nativeStoppedAt: row.native_stopped_at, invalidatedAt: row.invalidated_at };
}
export function createNativeStopRepository(database: Database.Database): NativeStopRepository {
  return {
    find(agentId) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('fleet_native_stop')
        .where(row => row.agent_id === params.agentId).orderByDescending(row => row.sequence).firstOrDefault(), { agentId });
      return success(row ? mapStop(row) : null);
    }); },
    receipt(agentId, receiptId) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('fleet_native_stop')
        .where(row => row.agent_id === params.agentId && row.receipt_id === params.receiptId).firstOrDefault(), { agentId, receiptId });
      return success(row ? mapStop(row) : null);
    }); },
    insert(value) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('fleet_native_stop').values({ agent_id: params.agentId,
        receipt_id: params.receiptId, sequence: params.sequence, fleet_id: params.fleetId, run_id: params.runId,
        connection_id: params.connectionId, credential_id: params.credentialId, native_stopped_at: params.nativeStoppedAt,
        invalidated_at: params.invalidatedAt }), value);
      return success(undefined);
    }); },
    invalidate(agentId, now) { return stored(() => {
      executeUpdate(database, schema, (query, params) => query.update('fleet_native_stop').set({ invalidated_at: params.now })
        .where(row => row.agent_id === params.agentId && row.invalidated_at === null), { agentId, now });
      return success(undefined);
    }); },
  };
}
