import { failure, type Result } from '../../../kernel/src/result.js';
export function stored<T>(operation: () => Result<T>): Result<T> {
  try { return operation(); }
  catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      if (error.code.startsWith('SQLITE_CONSTRAINT')) return failure('conflict', 'The operation conflicts with the current stored state');
      if (error.code === 'SQLITE_BUSY') return failure('unavailable', 'Storage is busy; retry this operation');
    }
    throw error;
  }
}
