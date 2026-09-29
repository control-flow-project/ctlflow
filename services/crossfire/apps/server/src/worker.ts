import type { Services } from '../../../packages/domain/src/port/services.js';
import { reconcile } from '../../../packages/domain/src/maintenance/reconcile.js';
export function createWorker(services: Services) {
  let running: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false, stopped = false;
  function drain(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) { pending = true; return running; }
    if (timer) clearTimeout(timer);
    running = (async () => {
      do {
        pending = false;
        const result = await reconcile(services, () => stopped);
        if (!result.ok) process.stderr.write('Crossfire reconciliation remains pending: ' + result.error.code + '\n');
      } while (pending && !stopped);
    })().catch(() => { process.stderr.write('Crossfire reconciliation failed; native state remains unverified.\n'); }).finally(() => {
      running = undefined;
      if (!stopped) { timer = setTimeout(() => { void drain(); }, 5000); timer.unref(); }
    });
    return running;
  }
  return { drain, wake() { void drain(); }, async stop() { stopped = true; if (timer) clearTimeout(timer); await running; } };
}
