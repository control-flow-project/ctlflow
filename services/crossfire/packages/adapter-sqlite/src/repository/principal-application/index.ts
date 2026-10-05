import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapPrincipalApplication } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { PrincipalApplicationRepository } from '@ctlflow/crossfire-domain/port/repositories';

export function createPrincipalApplicationRepository(database: Database.Database): PrincipalApplicationRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('principal_application')
          .where(row => row.principal_id === params.principalId).firstOrDefault(), key);
        return success(row ? mapPrincipalApplication(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('principal_application').values({
      principal_id: params.principalId,
      applied_revision: params.appliedRevision,
      applied_intent_hash: params.appliedIntentHash,
      applied_status: params.appliedStatus,
      native_display_name: params.nativeDisplayName,
      last_attempt_at: params.lastAttemptAt,
      last_success_at: params.lastSuccessAt,
      next_check_at: params.nextCheckAt,
      error_code: params.errorCode,
      error_message: params.errorMessage,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('principal_application').set({
      applied_revision: params.appliedRevision,
      applied_intent_hash: params.appliedIntentHash,
      applied_status: params.appliedStatus,
      native_display_name: params.nativeDisplayName,
      last_attempt_at: params.lastAttemptAt,
      last_success_at: params.lastSuccessAt,
      next_check_at: params.nextCheckAt,
      error_code: params.errorCode,
      error_message: params.errorMessage,
        }).where(row => row.principal_id === params.principalId), value);
        return changed === 1 ? success(undefined) : failure('missing', 'PrincipalApplication not found');
      });
    },
  };
}
