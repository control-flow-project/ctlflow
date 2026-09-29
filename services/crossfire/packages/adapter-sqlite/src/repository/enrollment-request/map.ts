import type { EnrollmentRequest } from '../../../../domain/src/enrollment/types.js';
import type { Tables } from '../../schema/tables.js';
export function mapEnrollmentRequest(row: Tables['enrollment_request']): EnrollmentRequest {
  return {
    id: row.id,
    ownerId: row.owner_id,
    fleetKey: row.fleet_key,
    verificationCode: row.verification_code,
    claimHash: row.claim_hash,
    rosterDigest: row.roster_digest,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    decidedByMemberId: row.decided_by_member_id,
    decidedAt: row.decided_at,
  };
}
