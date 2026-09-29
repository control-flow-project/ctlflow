import type { MemberInvitation } from '../../../../domain/src/activity/types.js';
import type { Tables } from '../../schema/tables.js';
export function mapMemberInvitation(row: Tables['member_invitation']): MemberInvitation {
  return {
    id: row.id,
    createdByMemberId: row.created_by_member_id,
    claimHash: row.claim_hash,
    roleCode: row.role_code,
    principalKind: row.principal_kind,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedByMemberId: row.consumed_by_member_id,
    revokedAt: row.revoked_at,
    claimMatrixUserId: row.claim_matrix_user_id,
    claimDisplayName: row.claim_display_name,
    claimFingerprint: row.claim_fingerprint,
  };
}
