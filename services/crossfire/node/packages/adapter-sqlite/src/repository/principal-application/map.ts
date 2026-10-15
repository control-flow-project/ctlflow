import type { PrincipalApplication } from '@ctlflow/crossfire-domain/identity/types';
import type { Tables } from '../../schema/tables.js';
export function mapPrincipalApplication(row: Tables['principal_application']): PrincipalApplication {
  return {
    principalId: row.principal_id,
    appliedRevision: row.applied_revision,
    appliedIntentHash: row.applied_intent_hash,
    appliedStatus: row.applied_status,
    nativeDisplayName: row.native_display_name,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    nextCheckAt: row.next_check_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}
