import type { Services } from '@ctlflow/crossfire-domain/port/services';
import { reconcile } from '@ctlflow/crossfire-domain/maintenance/reconcile';
import { maintainPublications } from '@ctlflow/crossfire-domain/publication/maintenance';
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
        if (!stopped) {
          const publications = await maintainPublications(services);
          if (!publications.ok) process.stderr.write('Crossfire report cleanup remains pending: ' + publications.error.code + '\n');
        }
      } while (pending && !stopped);
    })().catch(() => { process.stderr.write('Crossfire reconciliation failed; native state remains unverified.\n'); }).finally(() => {
      running = undefined;
      if (!stopped) { timer = setTimeout(() => { void drain(); }, 5000); timer.unref(); }
    });
    return running;
  }
  return { drain, wake() { void drain(); }, async stop() { stopped = true; if (timer) clearTimeout(timer); await running; } };
}
