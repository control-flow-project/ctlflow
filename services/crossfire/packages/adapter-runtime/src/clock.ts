import { setTimeout as delay } from 'node:timers/promises';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';

export const nativeClock: Clock = {
  now: Date.now,
  delay: async (milliseconds, signal) => { await delay(milliseconds, undefined, { signal }); },
  deadline: milliseconds => AbortSignal.timeout(milliseconds),
  schedule: (callback, milliseconds, recurring = false) => {
    const timer = recurring ? setInterval(callback, milliseconds) : setTimeout(callback, milliseconds);
    return () => { if (recurring) clearInterval(timer); else clearTimeout(timer); };
  },
};
