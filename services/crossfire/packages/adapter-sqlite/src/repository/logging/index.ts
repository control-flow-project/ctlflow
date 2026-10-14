import type Database from 'better-sqlite3';
import { success } from '@ctlflow/crossfire-kernel/result';
import type { LoggingRetention } from '@ctlflow/crossfire-domain/port/logging';
import { stored } from '../stored.js';
import { pruneStatistics } from './statistics.js';
import { pruneRuntime, pruneRuns } from './runtime.js';
import type { ScanCursor } from './cursor.js';
import { pruneWorkflows } from './workflows.js';
import { createUnitOfWork } from '../../unit-of-work.js';
import { pruneSessionOperations } from './operations.js';

export function createLoggingRetention(database: Database.Database, days: number): LoggingRetention {
  const unitOfWork = createUnitOfWork(database);
  let cursor: ScanCursor | null = null, operationCursor: ScanCursor | null = null, previousCutoff = -Infinity;
  return { days, prune(cutoff, limit) {
    const result = unitOfWork.run(() => stored(() => {
      const batches = [...pruneStatistics(database, cutoff, limit), ...pruneWorkflows(database, cutoff, limit),
        ...pruneRuntime(database, cutoff, limit)];
      const runs = pruneRuns(database, cutoff, limit, cutoff < previousCutoff ? null : cursor);
      const operations = pruneSessionOperations(database, cutoff, limit, cutoff < previousCutoff ? null : operationCursor);
      return success({ removed: runs.removed + operations.removed + batches.reduce((total, count) => total + count, 0),
        more: runs.more || operations.more || batches.some(count => count === limit), cursor: runs.cursor, operationCursor: operations.cursor });
    }));
    if (!result.ok) return result;
    cursor = result.value.cursor; operationCursor = result.value.operationCursor; previousCutoff = cutoff;
    return success({ removed: result.value.removed, more: result.value.more });
  } };
}
