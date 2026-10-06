import type { Result } from '@ctlflow/crossfire-kernel/result';
export type UnitOfWork = { run<T>(operation: () => Result<T>): Result<T> };
