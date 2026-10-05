import type Database from 'better-sqlite3';
import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { FleetMessageDelivery, FleetMessageDeliveryRepository } from '@ctlflow/crossfire-domain/fleet/control-types';
import { schema, type Tables } from '../../schema/tables.js';
import { stored } from '../stored.js';

function mapDelivery(row: Tables['fleet_message_delivery']): FleetMessageDelivery {
  return { messageId: row.message_id, agentId: row.agent_id, status: row.status, completedAt: row.completed_at, errorMessage: row.error_message };
}
export function createFleetMessageDeliveryRepository(database: Database.Database): FleetMessageDeliveryRepository {
  return {
    pendingForAgent(agentId, now) { return stored(() => success(executeSelect(database, schema, (query, params) => query.from('fleet_message_delivery')
      .where(row => row.agent_id === params.agentId && row.status === 'pending')
      .join(query.from('fleet_message'), delivery => delivery.message_id, message => message.id, (delivery, message) => ({ delivery, message }))
      .where(row => row.message.expires_at > params.now).count(), { agentId, now }) > 0)); },
    find(messageId, agentId) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('fleet_message_delivery')
        .where(row => row.message_id === params.messageId && row.agent_id === params.agentId).firstOrDefault(), { messageId, agentId });
      return success(row ? mapDelivery(row) : null);
    }); },
    forMessages(messageIds) { return stored(() => success(messageIds.length ? executeSelect(database, schema, (query, params) => query.from('fleet_message_delivery')
      .where(row => params.messageIds.includes(row.message_id)).orderBy(row => row.message_id).thenBy(row => row.agent_id), { messageIds }).map(mapDelivery) : [])); },
    insert(delivery) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('fleet_message_delivery').values({ message_id: params.messageId,
        agent_id: params.agentId, status: params.status, completed_at: params.completedAt, error_message: params.errorMessage }), delivery);
      return success(undefined);
    }); },
    update(delivery) { return stored(() => {
      const count = executeUpdate(database, schema, (query, params) => query.update('fleet_message_delivery').set({ status: params.status,
        completed_at: params.completedAt, error_message: params.errorMessage }).where(row => row.message_id === params.messageId && row.agent_id === params.agentId), delivery);
      return count === 1 ? success(undefined) : failure('missing', 'Fleet message recipient not found');
    }); },
    pending(fleetId, now) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('fleet_message_delivery').join(query.from('fleet_message'),
        delivery => delivery.message_id, message => message.id, (delivery, message) => ({ delivery, message }))
        .where(row => row.message.fleet_id === params.fleetId && row.message.expires_at > params.now && row.delivery.status === 'pending')
        .orderBy(row => row.message.created_at).thenBy(row => row.message.id).select(row => ({ messageId: row.message.id })).firstOrDefault(), { fleetId, now });
      return success(row?.messageId ?? null);
    }); },
    pendingCount(fleetId, now) { return stored(() => success(executeSelect(database, schema, (query, params) => query.from('fleet_message_delivery').join(query.from('fleet_message'),
      delivery => delivery.message_id, message => message.id, (delivery, message) => ({ delivery, message }))
      .where(row => row.message.fleet_id === params.fleetId && row.message.expires_at > params.now && row.delivery.status === 'pending')
      .select(row => ({ messageId: row.message.id })).distinct().count(), { fleetId, now }))); },
  };
}
