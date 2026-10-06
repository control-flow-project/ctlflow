import { failure } from '@ctlflow/crossfire-kernel/result';
import type { Actor } from '../port/services.js';
import { recordEvent } from '../audit/record-event.js';
import { publicationAuthority, type PublicationDependencies } from './authority.js';
import { readPublication } from './read.js';
export function commitPublication(services: PublicationDependencies, actor: Actor, id: string, expectedRevision: number, requestId: string) {
  return services.publication.store.exclusive(id, async () => {
    const current = publicationAuthority(services, actor, id, 'publish'); if (!current.ok) return current;
    const publication = current.value.publication;
    if (publication.state === 'published' && publication.revision === expectedRevision + 1) return readPublication(services, actor, id);
    if (publication.state !== 'staging' || publication.revision !== expectedRevision || publication.expiresAt <= services.clock.now())
      return failure('conflict', 'Report staging or revision changed');
    const files = services.publication.repository.files(id); if (!files.ok) return files;
    if (!files.value.every(file => file.uploaded)) return failure('conflict', 'Every declared report file must be uploaded before publication');
    const verified = await services.publication.store.verify(id, files.value); if (!verified.ok) return verified;
    return services.unitOfWork.run(() => {
      const authority = publicationAuthority(services, actor, id, 'publish'); if (!authority.ok) return authority;
      if (authority.value.publication.state !== 'staging' || authority.value.publication.revision !== expectedRevision
        || authority.value.publication.expiresAt <= services.clock.now()) return failure('conflict', 'Report staging changed during verification');
      const saved = services.publication.repository.publish(id, expectedRevision, services.clock.now()); if (!saved.ok) return saved;
      const audit = recordEvent(services, actor, requestId, { targetKind: 'publication', targetId: id,
        ownerId: authority.value.ownerId, action: 'publication.publish', permissionCode: 'publication.publish.self' });
      return audit.ok ? readPublication(services, actor, id) : audit;
    });
  });
}
