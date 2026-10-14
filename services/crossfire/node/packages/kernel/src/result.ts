export type FailureCode = 'invalid' | 'unauthorized' | 'forbidden' | 'missing' | 'conflict' | 'limit' | 'native' | 'unavailable'
  | 'stale_revision' | 'name_collision' | 'capacity' | 'rate_limit' | 'body_too_large' | 'method_not_allowed';
export type Failure = { code: FailureCode; message: string; fieldErrors?: Record<string, string> };
export type Result<T> = { ok: true; value: T } | { ok: false; error: Failure };
export function success<T>(value: T): Result<T> { return { ok: true, value }; }
export function failure<T = never>(code: FailureCode, message: string): Result<T> { return { ok: false, error: { code, message } }; }
export function failureError(error: Failure): Error & Failure { return Object.assign(new Error(error.message), error); }
