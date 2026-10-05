import type { Result } from '@ctlflow/crossfire-kernel/result';

export type WakeSchedule = { kind: 'interval'; seconds: number }
  | { kind: 'cron'; expression: string; timeZone: string };
export type ScheduleCalculator = { next(schedule: WakeSchedule, after: number): Result<number> };
