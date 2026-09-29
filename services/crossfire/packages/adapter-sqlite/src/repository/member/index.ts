import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapMember } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@crossfire/kernel/result';
import type { MemberRepository } from '@crossfire/domain/port/repositories';

export function createMemberRepository(database: Database.Database): MemberRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('member')
          .where(row => row.principal_id === params.principalId).firstOrDefault(), key);
        return success(row ? mapMember(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('member').values({
      principal_id: params.principalId,
      principal_kind: params.principalKind,
      display_name: params.displayName,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('member').set({
      principal_kind: params.principalKind,
      display_name: params.displayName,
        }).where(row => row.principal_id === params.principalId), value);
        return changed === 1 ? success(undefined) : failure('missing', 'Member not found');
      });
    },
  };
}
