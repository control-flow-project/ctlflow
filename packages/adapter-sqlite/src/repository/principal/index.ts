import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapPrincipal } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '../../../../kernel/src/result.js';
import type { PrincipalRepository } from '../../../../domain/src/port/repositories.js';

export function createPrincipalRepository(database: Database.Database): PrincipalRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('principal')
          .where(row => row.id === params.id).firstOrDefault(), key);
        return success(row ? mapPrincipal(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('principal').values({
      id: params.id,
      matrix_user_id: params.matrixUserId,
      kind: params.kind,
      status: params.status,
      revision: params.revision,
      created_at: params.createdAt,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('principal').set({
      matrix_user_id: params.matrixUserId,
      kind: params.kind,
      status: params.status,
      revision: params.revision,
      created_at: params.createdAt,
        }).where(row => row.id === params.id), value);
        return changed === 1 ? success(undefined) : failure('missing', 'Principal not found');
      });
    },
  };
}
