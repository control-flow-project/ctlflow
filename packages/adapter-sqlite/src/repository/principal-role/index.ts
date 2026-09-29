import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapPrincipalRole } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '../../../../kernel/src/result.js';
import type { PrincipalRoleRepository } from '../../../../domain/src/port/repositories.js';

export function createPrincipalRoleRepository(database: Database.Database): PrincipalRoleRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('principal_role')
          .where(row => row.principal_id === params.principalId).firstOrDefault(), key);
        return success(row ? mapPrincipalRole(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('principal_role').values({
      principal_id: params.principalId,
      principal_kind: params.principalKind,
      role_code: params.roleCode,
      assigned_by_member_id: params.assignedByMemberId,
      assigned_at: params.assignedAt,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('principal_role').set({
      principal_kind: params.principalKind,
      role_code: params.roleCode,
      assigned_by_member_id: params.assignedByMemberId,
      assigned_at: params.assignedAt,
        }).where(row => row.principal_id === params.principalId), value);
        return changed === 1 ? success(undefined) : failure('missing', 'PrincipalRole not found');
      });
    },
  };
}
