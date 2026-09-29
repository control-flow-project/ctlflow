import { executeSelect, executeInsert } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapPermission } from './map.js';
import { stored } from '../stored.js';
import { success } from '@crossfire/kernel/result';
import type { PermissionRepository } from '@crossfire/domain/port/repositories';

export function createPermissionRepository(database: Database.Database): PermissionRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('permission')
          .where(row => row.code === params.code).firstOrDefault(), key);
        return success(row ? mapPermission(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('permission').values({
      code: params.code,
      grant_scope: params.grantScope,
      description: params.description,
        }), value);
        return success(undefined);
      });
    },
  };
}
