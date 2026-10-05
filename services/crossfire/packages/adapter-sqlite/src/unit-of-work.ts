import type Database from 'better-sqlite3';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { UnitOfWork } from '@ctlflow/crossfire-domain/port/unit-of-work';

export function createUnitOfWork(database: Database.Database): UnitOfWork {
  return {
    run<T>(operation: () => Result<T>): Result<T> {
      const rollback = Symbol('domain rollback');
      let rejected: Result<T> | undefined;
      try {
        return database.transaction(() => {
          const result = operation();
          if (!result || typeof result !== 'object' || !('ok' in result)) throw new TypeError('A transaction must return a synchronous Result');
          if (!result.ok) { rejected = result; throw rollback; }
          return result;
        }).immediate();
      } catch (error) {
        if (error === rollback && rejected) return rejected;
        throw error;
      }
    },
  };
}
