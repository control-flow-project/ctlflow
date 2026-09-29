import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapEnrollmentRequest } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@crossfire/kernel/result';
import type { EnrollmentRequestRepository } from '@crossfire/domain/port/repositories';

export function createEnrollmentRequestRepository(database: Database.Database): EnrollmentRequestRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('enrollment_request')
          .where(row => row.id === params.id).firstOrDefault(), key);
        return success(row ? mapEnrollmentRequest(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('enrollment_request').values({
      controller_name: params.controllerName,
      controller_credential_hash: params.controllerCredentialHash,
      id: params.id,
      owner_id: params.ownerId,
      fleet_key: params.fleetKey,
      verification_code: params.verificationCode,
      claim_hash: params.claimHash,
      roster_digest: params.rosterDigest,
      status: params.status,
      revision: params.revision,
      created_at: params.createdAt,
      expires_at: params.expiresAt,
      decided_by_member_id: params.decidedByMemberId,
      decided_at: params.decidedAt,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('enrollment_request').set({
      controller_name: params.controllerName,
      controller_credential_hash: params.controllerCredentialHash,
      owner_id: params.ownerId,
      fleet_key: params.fleetKey,
      verification_code: params.verificationCode,
      claim_hash: params.claimHash,
      roster_digest: params.rosterDigest,
      status: params.status,
      revision: params.revision,
      created_at: params.createdAt,
      expires_at: params.expiresAt,
      decided_by_member_id: params.decidedByMemberId,
      decided_at: params.decidedAt,
        }).where(row => row.id === params.id), value);
        return changed === 1 ? success(undefined) : failure('missing', 'EnrollmentRequest not found');
      });
    },
  };
}
