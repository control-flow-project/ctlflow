import { failure, success } from '@crossfire/kernel/result';
import { activeActor } from '../authorization/authorize.js';
import { publicationAuthority, type PublicationDependencies } from './authority.js';
import type { Actor } from '../port/services.js';
import type { PublicationRecord } from './port.js';
import type { PublicationSummary, PublicationQuery } from './values.js';
export function publicationSummary(origin: string, actor: Actor, permissions: readonly string[], record: PublicationRecord): PublicationSummary {
  const { publicKey, cleanedAt, ...publication } = record.publication;
  const canDelete = actor.kind === 'human' && (permissions.includes('publication.delete.any')
    || record.ownerId === actor.principalId && permissions.includes('publication.delete.owned'));
  return { ...publication, agentName: record.agentName, ownerId: record.ownerId, ownerName: record.ownerName,
    url: publication.state === 'published' ? origin + '/' + publicKey + '/index.html' : null,
    allowedActions: canDelete && publication.state !== 'deleted' ? ['delete'] : [] };
}
export function readPublication(services: PublicationDependencies, actor: Actor, id: string) {
  const record = publicationAuthority(services, actor, id, 'read'); if (!record.ok) return record;
  const permissions = services.directory.permissions(actor.principalId); if (!permissions.ok) return permissions;
  const files = services.publication.repository.files(id); if (!files.ok) return files;
  return success({ ...publicationSummary(services.publication.origin, actor, permissions.value, record.value), files: files.value.map(({ publicationId, ...file }) => file) });
}
export function readPublications(services: PublicationDependencies, actor: Actor, input: PublicationQuery) {
  const current = activeActor(services, actor); if (!current.ok) return current;
  const permissions = services.directory.permissions(actor.principalId); if (!permissions.ok) return permissions;
  if (actor.kind !== 'human' || !permissions.value.includes('publication.read.any') && (!permissions.value.includes('publication.read.owned')
    || input.ownerId !== undefined && input.ownerId !== actor.principalId)) return failure('forbidden', 'Report owner scope is not permitted');
  const scope = permissions.value.includes('publication.read.any') ? input : { ...input, ownerId: actor.principalId };
  const page = services.publication.repository.page(scope);
  return page.ok ? success({ ...page.value, items: page.value.items.map(record => publicationSummary(services.publication.origin, actor, permissions.value, record)) }) : page;
}
