import type { MemberSession } from '@ctlflow/crossfire-domain/activity/types';
import type { Tables } from '../../schema/tables.js';
export function mapMemberSession(row: Tables['member_session']): MemberSession {
  return {
    secretHash: row.secret_hash,
    memberId: row.member_id,
    csrfSecret: row.csrf_secret,
    nativeAccessToken: row.native_access_token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
