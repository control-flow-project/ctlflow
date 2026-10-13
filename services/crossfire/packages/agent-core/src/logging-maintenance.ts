import type { Clock } from './port.js';
import { failure, type Result } from '@ctlflow/crossfire-kernel/result';

export function createLoggingMaintenance(clock: Pick<Clock, 'schedule'>, sweep: () => Promise<Result<{ more: boolean }>>, intervalMs: number,
  report: (message: string | null) => void) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new Error('Logging maintenance needs a positive exact interval');
  let stopped = false, running: Promise<Result<{ more: boolean }>> | undefined, cancel: (() => void) | undefined;
  let problem: string | null = null;
  function drain() {
    if (running) return running;
    if (stopped) return Promise.resolve(failure('unavailable', 'Logging maintenance stopped'));
    cancel?.(); cancel = undefined;
    running = Promise.resolve().then(sweep).catch(() => failure('unavailable', 'Logging maintenance failed')).then(result => {
      problem = result.ok ? null : result.error.message;
      report(problem);
      return result;
    }).finally(() => { running = undefined; });
    void running.then(result => {
      if (!stopped) cancel = clock.schedule(() => { void drain(); }, !result.ok || result.value.more ? 5000 : intervalMs);
    });
    return running;
  }
  void drain();
  return { drain, error: () => problem, async close() { stopped = true; cancel?.(); cancel = undefined; await running; } };
}
