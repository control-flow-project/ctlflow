import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { authorize, activeActor } from '../authorization/authorize.js';
import type { Actor, Services } from '../port/services.js';
import type { PublicationRecord } from './port.js';
import { admitsController } from '../listener/admission.js';
import { HEARTBEAT_EXPIRY_MS } from '../listener/report.js';
export type PublicationDependencies = Pick<Services, 'publication' | 'repositories' | 'directory' | 'listenerRead' | 'clock' | 'unitOfWork' | 'identity'>;
function publisherLease(services: PublicationDependencies, agentId: string) {
  const now = services.clock.now();
  const runs = services.listenerRead.admissionCandidates([agentId], now - HEARTBEAT_EXPIRY_MS); if (!runs.ok) return runs;
  for (const { run, facts } of runs.value) {
    if (run.disconnectRequestedAt !== null) continue;
    if (admitsController(run, facts, now, 'reporting')) return success(undefined);
  }
  return failure('forbidden', 'Publication requires the current authenticated fleet controller listener');
}
export function publicationAuthority(services: PublicationDependencies, actor: Actor, id: string, action: 'read' | 'publish' | 'delete'): Result<PublicationRecord> {
  const current = activeActor(services, actor); if (!current.ok) return current;
  if (actor.kind === 'agent') { const lease = publisherLease(services, actor.principalId); if (!lease.ok) return lease; }
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
  const authority = authorize(services, actor, 'publication.publish.self'); if (!authority.ok) return authority;
  return publisherLease(services, actor.principalId);
}
