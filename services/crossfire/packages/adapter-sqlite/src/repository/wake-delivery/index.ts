import type Database from 'better-sqlite3';
import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { failure, success } from '@crossfire/kernel/result';
import type { WakeDelivery, WakeDeliveryRepository } from '@crossfire/domain/wake-up/types';
import { schema, type Tables } from '../../schema/tables.js';
import { stored } from '../stored.js';

function mapDelivery(row: Tables['wake_delivery']): WakeDelivery {
  return { id: row.id, ruleId: row.rule_id, agentId: row.agent_id, ruleRevision: row.rule_revision, runId: row.run_id, sessionId: row.session_id,
    scheduledAt: row.scheduled_at, createdAt: row.created_at, status: row.status, deliveredAt: row.delivered_at };
}
export function createWakeDeliveryRepository(database: Database.Database): WakeDeliveryRepository {
  return {
    find(id) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('wake_delivery').where(row => row.id === params.id).firstOrDefault(), { id });
      return success(row ? mapDelivery(row) : null);
    }); },
    pending(agentId) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('wake_delivery')
        .where(row => row.agent_id === params.agentId && row.status === 'pending').firstOrDefault(), { agentId });
      return success(row ? mapDelivery(row) : null);
    }); },
    insert(delivery) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('wake_delivery').values({ id: params.id, rule_id: params.ruleId,
        agent_id: params.agentId, rule_revision: params.ruleRevision, run_id: params.runId, session_id: params.sessionId, scheduled_at: params.scheduledAt,
        created_at: params.createdAt, status: params.status, delivered_at: params.deliveredAt }), delivery);
      return success(undefined);
    }); },
    update(delivery) { return stored(() => {
      const count = executeUpdate(database, schema, (query, params) => query.update('wake_delivery').set({
        run_id: params.runId, status: params.status, delivered_at: params.deliveredAt,
      }).where(row => row.id === params.id), delivery);
      return count === 1 ? success(undefined) : failure('missing', 'Wake-up delivery not found');
    }); },
    cancelPending(ruleId) { return stored(() => {
      executeUpdate(database, schema, (query, params) => query.update('wake_delivery').set({ status: 'cancelled' })
        .where(row => row.rule_id === params.ruleId && row.status === 'pending'), { ruleId });
      return success(undefined);
    }); },
  };
}
