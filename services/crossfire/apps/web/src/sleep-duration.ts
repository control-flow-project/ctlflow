import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';

export function sleepDurationSeconds(minutes: string, maximumSeconds: number): Result<number> {
  const text = minutes.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(text)) return failure('invalid', 'Enter the idle time in minutes, or 0 to disable automatic sleep.');
  const requested = Number(text) * 60, seconds = Math.round(requested);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > maximumSeconds) {
    return failure('invalid', 'Choose an idle time from 0 to ' + maximumSeconds / 60 + ' minutes.');
  }
  if (Math.abs(requested - seconds) > 0.0000001 || seconds === 0 && !/^0*(?:\.0*)?$/u.test(text)) {
    return failure('invalid', 'The idle time must be a whole number of seconds.');
  }
  return success(seconds);
}
