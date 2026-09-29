import type { Result } from '../../../kernel/src/result.js';
export type UnitOfWork = { run<T>(operation: () => Result<T>): Result<T> };
