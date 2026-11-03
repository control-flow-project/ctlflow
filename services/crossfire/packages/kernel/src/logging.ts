import { failure, success, type Result } from './result.js';

export const DAY_MS = 86_400_000;
export const DEFAULT_LOGGING_RETENTION_DAYS = 7;
export const LOGGING_MAINTENANCE_MS = 3_600_000;

export function loggingRetentionDays(value: unknown = DEFAULT_LOGGING_RETENTION_DAYS): Result<number> {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && Number.isSafeInteger(value * DAY_MS)
    ? success(value) : failure('invalid', 'loggingRetentionDays must be a positive exact integer number of days');
}
