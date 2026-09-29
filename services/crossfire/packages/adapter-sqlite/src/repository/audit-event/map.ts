import type { AuditEvent } from '@crossfire/domain/audit/types';
import type { Tables } from '../../schema/tables.js';
export function mapAuditEvent(row: Tables['audit_event']): AuditEvent {
  return {
    id: row.id,
    requestId: row.request_id,
    actorCredentialId: row.actor_credential_id,
    actorKind: row.actor_kind,
    actorPrincipalId: row.actor_principal_id,
    ownerId: row.owner_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    roomId: row.room_id,
    membershipGeneration: row.membership_generation,
    authorizerId: row.authorizer_id,
    addedById: row.added_by_id,
    permissionCode: row.permission_code,
    action: row.action,
    outcome: row.outcome,
    message: row.message,
    createdAt: row.created_at,
  };
}
