import type { Result } from '@crossfire/kernel/result';
export type UnitOfWork = { run<T>(operation: () => Result<T>): Result<T> };
