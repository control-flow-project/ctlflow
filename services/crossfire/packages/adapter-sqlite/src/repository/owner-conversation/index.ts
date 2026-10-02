import { executeSelect, executeInsert } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { success } from '@crossfire/kernel/result';
import type { OwnerConversationRepository } from '@crossfire/domain/owner-conversation/types';
import { schema } from '../../schema/tables.js';
import { stored } from '../stored.js';

export function createOwnerConversationRepository(database: Database.Database): OwnerConversationRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('agent_owner_conversation')
          .where(row => row.agent_id === params.agentId).firstOrDefault(), key);
        return success(row ? { agentId: row.agent_id, ownerId: row.owner_id, roomId: row.room_id, createdAt: row.created_at } : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('agent_owner_conversation')
          .values({ agent_id: params.agentId, owner_id: params.ownerId, room_id: params.roomId, created_at: params.createdAt }), value);
        return success(undefined);
      });
    },
  };
}
