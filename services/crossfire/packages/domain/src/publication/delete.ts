import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Actor } from '../port/services.js';
import { recordEvent } from '../audit/record-event.js';
import { publicationAuthority, type PublicationDependencies } from './authority.js';
export async function deletePublication(services: PublicationDependencies, actor: Actor, id: string, expectedRevision: number, requestId: string) {
  const fenced = services.unitOfWork.run(() => {
    const current = publicationAuthority(services, actor, id, 'delete'); if (!current.ok) return current;
    if (current.value.publication.state === 'deleted' && current.value.publication.revision === expectedRevision + 1) return success(undefined);
    if (current.value.publication.revision !== expectedRevision || current.value.publication.state === 'deleted') return failure('conflict', 'Report revision changed');
    const saved = services.publication.repository.fence(id, expectedRevision, services.clock.now()); if (!saved.ok) return saved;
    return recordEvent(services, actor, requestId, { targetKind: 'publication', targetId: id, ownerId: current.value.ownerId, action: 'publication.delete' });
  });
  if (!fenced.ok) return fenced;
  await services.publication.store.exclusive(id, async () => {
    const removed = await services.publication.store.remove(id); if (!removed.ok) return removed;
    return services.publication.repository.cleaned(id, services.clock.now());
  });
  return success({ deleted: true });
}
