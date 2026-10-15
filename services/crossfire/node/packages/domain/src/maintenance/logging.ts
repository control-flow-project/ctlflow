import { DAY_MS } from '@ctlflow/crossfire-kernel/logging';
import { failure } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';

export function maintainLogging(services: Pick<Services, 'logging' | 'clock'>, limit = 500) {
  const cutoff = services.clock.now() - services.logging.days * DAY_MS;
  if (!Number.isSafeInteger(cutoff) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    return failure('invalid', 'Logging cleanup requires an exact cutoff and a 1..1000 record batch');
  return services.logging.prune(cutoff, limit);
}
