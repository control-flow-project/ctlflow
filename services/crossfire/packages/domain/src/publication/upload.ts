import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { BinaryInput } from '@ctlflow/crossfire-kernel/bytes';
import type { Actor } from '../port/services.js';
import { publicationAuthority, type PublicationDependencies } from './authority.js';
export function uploadPublicationFile(services: PublicationDependencies, actor: Actor, id: string, fileId: string, input: BinaryInput, signal: AbortSignal) {
  return services.publication.store.exclusive(id, async () => {
    const current = publicationAuthority(services, actor, id, 'publish'); if (!current.ok) return current;
    if (current.value.publication.state !== 'staging' || current.value.publication.expiresAt <= services.clock.now()) return failure('conflict', 'Report staging is no longer writable');
    const files = services.publication.repository.files(id); if (!files.ok) return files;
    const file = files.value.find(file => file.id === fileId); if (!file) return failure('missing', 'Declared report file not found');
    if (input.byteLength !== file.bytes) return failure('invalid', 'Upload size does not match its declared file');
    const stored = await services.publication.store.upload(id, file, input, signal); if (!stored.ok) return stored;
    return services.unitOfWork.run(() => {
      const authority = publicationAuthority(services, actor, id, 'publish'); if (!authority.ok) return authority;
      if (authority.value.publication.state !== 'staging' || authority.value.publication.expiresAt <= services.clock.now()) return failure('conflict', 'Report staging changed during upload');
      const saved = services.publication.repository.uploaded(id, fileId);
      return saved.ok ? success({ uploaded: true }) : saved;
    });
  });
}
