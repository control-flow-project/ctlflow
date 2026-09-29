import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapMemberInvitation } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '../../../../kernel/src/result.js';
import type { MemberInvitationRepository } from '../../../../domain/src/port/repositories.js';

export function createMemberInvitationRepository(database: Database.Database): MemberInvitationRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('member_invitation')
          .where(row => row.id === params.id).firstOrDefault(), key);
        return success(row ? mapMemberInvitation(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('member_invitation').values({
      id: params.id,
      created_by_member_id: params.createdByMemberId,
      claim_hash: params.claimHash,
      role_code: params.roleCode,
      principal_kind: params.principalKind,
      created_at: params.createdAt,
      expires_at: params.expiresAt,
      consumed_by_member_id: params.consumedByMemberId,
      revoked_at: params.revokedAt,
      claim_matrix_user_id: params.claimMatrixUserId,
      claim_display_name: params.claimDisplayName,
      claim_fingerprint: params.claimFingerprint,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('member_invitation').set({
      created_by_member_id: params.createdByMemberId,
      claim_hash: params.claimHash,
      role_code: params.roleCode,
      principal_kind: params.principalKind,
      created_at: params.createdAt,
      expires_at: params.expiresAt,
      consumed_by_member_id: params.consumedByMemberId,
      revoked_at: params.revokedAt,
      claim_matrix_user_id: params.claimMatrixUserId,
      claim_display_name: params.claimDisplayName,
      claim_fingerprint: params.claimFingerprint,
        }).where(row => row.id === params.id), value);
        return changed === 1 ? success(undefined) : failure('missing', 'MemberInvitation not found');
      });
    },
  };
}
