import type Database from 'better-sqlite3';
import { executeSelect, executeInsert } from '@tinqerjs/better-sqlite3-adapter';
import { success } from '@ctlflow/crossfire-kernel/result';
import type { FleetMessage, FleetMessageRepository } from '@ctlflow/crossfire-domain/fleet/control-types';
import { schema, type Tables } from '../../schema/tables.js';
import { stored } from '../stored.js';
import { page } from '../directory/index.js';

function mapMessage(row: Tables['fleet_message']): FleetMessage {
  return { id: row.id, fleetId: row.fleet_id, authorPrincipalId: row.author_principal_id, authorCredentialId: row.author_credential_id,
    body: row.body, createdAt: row.created_at, expiresAt: row.expires_at };
}
export function createFleetMessageRepository(database: Database.Database): FleetMessageRepository {
  return {
    find(id) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('fleet_message').where(row => row.id === params.id).firstOrDefault(), { id });
      return success(row ? mapMessage(row) : null);
    }); },
    insert(message) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('fleet_message').values({ id: params.id, fleet_id: params.fleetId,
        author_principal_id: params.authorPrincipalId, author_credential_id: params.authorCredentialId,
        body: params.body, created_at: params.createdAt, expires_at: params.expiresAt }), message);
      return success(undefined);
    }); },
    page(fleetId, input) { return stored(() => {
      const params = { fleetId, offset: (input.page - 1) * input.pageSize, limit: input.pageSize };
      const total = executeSelect(database, schema, (query, params) => query.from('fleet_message').where(row => row.fleet_id === params.fleetId).count(), params);
      const rows = executeSelect(database, schema, (query, params) => query.from('fleet_message').where(row => row.fleet_id === params.fleetId)
        .orderByDescending(row => row.created_at).thenByDescending(row => row.id).skip(params.offset).take(params.limit), params);
      return success(page(rows.map(mapMessage), total, input));
    }); },
  };
}
