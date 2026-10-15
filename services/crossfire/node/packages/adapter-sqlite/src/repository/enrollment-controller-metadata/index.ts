import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapEnrollmentControllerMetadata } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { EnrollmentControllerMetadataRepository } from '@ctlflow/crossfire-domain/port/repositories';
export function createEnrollmentControllerMetadataRepository(database: Database.Database): EnrollmentControllerMetadataRepository {
  return {
    find(key) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('enrollment_controller_metadata').where(row => row.enrollment_id === params.enrollmentId && row.key === params.key).firstOrDefault(), key);
      return success(row ? mapEnrollmentControllerMetadata(row) : null);
    }); },
    insert(value) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('enrollment_controller_metadata').values({
          enrollment_id: params.enrollmentId,
          key: params.key,
          value: params.value,
      }), value); return success(undefined);
    }); },
    update(value) { return stored(() => {
      const changed = executeUpdate(database, schema, (query, params) => query.update('enrollment_controller_metadata').set({
        value: params.value,
      }).where(row => row.enrollment_id === params.enrollmentId && row.key === params.key), value);
      return changed === 1 ? success(undefined) : failure('missing', 'EnrollmentControllerMetadata not found');
    }); },
    remove(key) { return stored(() => { executeDelete(database, schema, (query, params) => query.deleteFrom('enrollment_controller_metadata').where(row => row.enrollment_id === params.enrollmentId && row.key === params.key), key); return success(undefined); }); },
  };
}
