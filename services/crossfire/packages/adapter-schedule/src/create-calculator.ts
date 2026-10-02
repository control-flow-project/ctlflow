import { CronExpressionParser } from 'cron-parser';
import { failure, success } from '@crossfire/kernel/result';
import type { ScheduleCalculator } from '@crossfire/domain/port/schedule';

export function createScheduleCalculator(): ScheduleCalculator {
  return { next(schedule, after) {
    if (!Number.isSafeInteger(after) || after < 0) return failure('invalid', 'Invalid scheduling time');
    if (schedule.kind === 'interval') {
      if (!Number.isSafeInteger(schedule.seconds) || schedule.seconds < 1 || schedule.seconds > 31_536_000) {
        return failure('invalid', 'Interval must be between 1 second and 365 days');
      }
      const next = after + schedule.seconds * 1000;
      return Number.isSafeInteger(next) ? success(next) : failure('invalid', 'Scheduling time exceeds the supported range');
    }
    const expression = schedule.expression.trim();
    if (expression.length > 200 || expression.split(/\s+/u).length !== 5 || /\bH(?:\(|\b)/u.test(expression)) {
      return failure('invalid', 'Use five cron fields: minute, hour, day of month, month, day of week; randomized fields are not supported');
    }
    if (schedule.timeZone.length > 100 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/u.test(schedule.timeZone)) {
      return failure('invalid', 'Choose an IANA time zone, such as Asia/Kolkata or Europe/London');
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: schedule.timeZone });
      const next = CronExpressionParser.parse(expression, { currentDate: after, tz: schedule.timeZone }).next().getTime();
      return Number.isSafeInteger(next) && next > after ? success(next) : failure('invalid', 'The schedule has no next occurrence');
    } catch (error) {
      return failure('invalid', 'Invalid calendar schedule or time zone: ' + (error instanceof Error ? error.message : 'unknown error'));
    }
  } };
}
