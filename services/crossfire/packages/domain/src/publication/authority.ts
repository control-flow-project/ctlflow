import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { authorize, activeActor } from '../authorization/authorize.js';
import type { Actor, Services } from '../port/services.js';
import type { PublicationRecord } from './port.js';
export type PublicationDependencies = Pick<Services, 'publication' | 'repositories' | 'directory' | 'clock' | 'unitOfWork' | 'identity'>;
export function publicationAuthority(services: PublicationDependencies, actor: Actor, id: string, action: 'read' | 'publish' | 'delete'): Result<PublicationRecord> {
  const current = activeActor(services, actor); if (!current.ok) return current;
  const record = services.publication.repository.find(id); if (!record.ok) return record;
  if (!record.value) return failure('missing', 'Report not found');
  const permissions = services.directory.permissions(actor.principalId); if (!permissions.ok) return permissions;
  const allowed = action !== 'delete' && actor.kind === 'agent' && actor.principalId === record.value.publication.agentId
    && permissions.value.includes('publication.publish.self')
    || action !== 'publish' && actor.kind === 'human' && (permissions.value.includes('publication.' + action + '.any')
      || record.value.ownerId === actor.principalId && permissions.value.includes('publication.' + action + '.owned'));
  return allowed ? success(record.value) : failure('missing', 'Report not found');
}
export function publicationPublisher(services: PublicationDependencies, actor: Actor) {
  if (actor.kind !== 'agent') return failure('forbidden', 'Only enrolled agents publish reports');
  return authorize(services, actor, 'publication.publish.self');
}
