import { success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
export function expireEnrollments(services: Pick<Services, 'repositories' | 'collection' | 'clock'>): Result<void> {
  const expired = services.collection.expiredEnrollments({ now: services.clock.now() });
  if (!expired.ok) return expired;
  for (const request of expired.value) {
    const names = services.collection.agentNamesByRequest({ requestId: request.id });
    if (!names.ok) return names;
    for (const name of names.value) {
      const removed = services.repositories.agentName.remove({ name: name.name });
      if (!removed.ok) return removed;
    }
    const changed = services.repositories.enrollmentRequest.update({ ...request, status: 'expired', revision: request.revision + 1 });
    if (!changed.ok) return changed;
  }
  return success(undefined);
}
