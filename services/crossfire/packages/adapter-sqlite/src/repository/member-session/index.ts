import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapMemberSession } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@crossfire/kernel/result';
import type { MemberSessionRepository } from '@crossfire/domain/port/repositories';

export function createMemberSessionRepository(database: Database.Database): MemberSessionRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('member_session')
          .where(row => row.secret_hash === params.secretHash).firstOrDefault(), key);
        return success(row ? mapMemberSession(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('member_session').values({
      secret_hash: params.secretHash,
      member_id: params.memberId,
      csrf_secret: params.csrfSecret,
      native_access_token: params.nativeAccessToken,
      created_at: params.createdAt,
      expires_at: params.expiresAt,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('member_session').set({
      member_id: params.memberId,
      csrf_secret: params.csrfSecret,
      native_access_token: params.nativeAccessToken,
      created_at: params.createdAt,
      expires_at: params.expiresAt,
        }).where(row => row.secret_hash === params.secretHash), value);
        return changed === 1 ? success(undefined) : failure('missing', 'MemberSession not found');
      });
    },
    remove(key) {
      return stored(() => {
        executeDelete(database, schema, (query, params) => query.deleteFrom('member_session')
          .where(row => row.secret_hash === params.secretHash), key);
        return success(undefined);
      });
    },
  };
}
