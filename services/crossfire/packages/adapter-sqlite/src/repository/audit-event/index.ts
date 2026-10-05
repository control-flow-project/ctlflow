import { executeSelect, executeInsert } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapAuditEvent } from './map.js';
import { stored } from '../stored.js';
import { success } from '@ctlflow/crossfire-kernel/result';
import type { AuditEventRepository } from '@ctlflow/crossfire-domain/port/repositories';

export function createAuditEventRepository(database: Database.Database): AuditEventRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('audit_event')
          .where(row => row.id === params.id).firstOrDefault(), key);
        return success(row ? mapAuditEvent(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('audit_event').values({
      id: params.id,
      request_id: params.requestId,
      actor_credential_id: params.actorCredentialId,
      actor_kind: params.actorKind,
      actor_principal_id: params.actorPrincipalId,
      owner_id: params.ownerId,
      target_kind: params.targetKind,
      target_id: params.targetId,
      room_id: params.roomId,
      membership_generation: params.membershipGeneration,
      authorizer_id: params.authorizerId,
      added_by_id: params.addedById,
      permission_code: params.permissionCode,
      action: params.action,
      outcome: params.outcome,
      message: params.message,
      created_at: params.createdAt,
        }), value);
        return success(undefined);
      });
    },
  };
}
