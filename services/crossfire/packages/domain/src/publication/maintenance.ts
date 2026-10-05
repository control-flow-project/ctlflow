import { success, type Result } from '@crossfire/kernel/result';
import type { PublicationDependencies } from './authority.js';
export async function maintainPublications(services: PublicationDependencies): Promise<Result<number>> {
  const pending = services.publication.repository.maintenance(services.clock.now(), 50); if (!pending.ok) return pending;
  let completed = 0;
  let pendingFailure: Result<never> | undefined;
  for (const publication of pending.value) {
    const result = await services.publication.store.exclusive(publication.id, async () => {
      const current = services.publication.repository.find(publication.id); if (!current.ok) return current;
      if (!current.value || current.value.publication.cleanedAt !== null || current.value.publication.state === 'published') return success(false);
      if (current.value.publication.state === 'staging') {
        if (current.value.publication.expiresAt > services.clock.now()) return success(false);
        const fenced = services.unitOfWork.run(() => services.publication.repository.fence(publication.id, current.value!.publication.revision, services.clock.now()));
        if (!fenced.ok) return fenced;
      }
      const removed = await services.publication.store.remove(publication.id); if (!removed.ok) return removed;
      const cleaned = services.publication.repository.cleaned(publication.id, services.clock.now());
      return cleaned.ok ? success(true) : cleaned;
    });
    if (result.ok && result.value) completed++;
    if (!result.ok && result.error.code !== 'conflict') pendingFailure = result;
  }
  return pendingFailure ?? success(completed);
}
