import { executeSelect, executeInsert } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapRole } from './map.js';
import { stored } from '../stored.js';
import { success } from '@ctlflow/crossfire-kernel/result';
import type { RoleRepository } from '@ctlflow/crossfire-domain/port/repositories';

export function createRoleRepository(database: Database.Database): RoleRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('role')
          .where(row => row.code === params.code).firstOrDefault(), key);
        return success(row ? mapRole(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('role').values({
      code: params.code,
      principal_kind: params.principalKind,
      label: params.label,
        }), value);
        return success(undefined);
      });
    },
  };
}
