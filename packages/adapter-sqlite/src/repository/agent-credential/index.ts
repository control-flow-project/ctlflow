import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapAgentCredential } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '../../../../kernel/src/result.js';
import type { AgentCredentialRepository } from '../../../../domain/src/port/repositories.js';

export function createAgentCredentialRepository(database: Database.Database): AgentCredentialRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('agent_credential')
          .where(row => row.agent_id === params.agentId).firstOrDefault(), key);
        return success(row ? mapAgentCredential(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('agent_credential').values({
      agent_id: params.agentId,
      provisioning_password: params.provisioningPassword,
      access_token: params.accessToken,
      updated_at: params.updatedAt,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('agent_credential').set({
      provisioning_password: params.provisioningPassword,
      access_token: params.accessToken,
      updated_at: params.updatedAt,
        }).where(row => row.agent_id === params.agentId), value);
        return changed === 1 ? success(undefined) : failure('missing', 'AgentCredential not found');
      });
    },
  };
}
