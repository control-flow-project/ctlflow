import type { Services } from '../port/services.js';
import type { FleetActor } from '../fleet/authority.js';
import type { AuditEvent } from './types.js';
export type AuditIntent = Pick<AuditEvent, 'targetKind' | 'targetId' | 'action'> & Partial<Pick<AuditEvent,
  'ownerId' | 'roomId' | 'membershipGeneration' | 'authorizerId' | 'addedById' | 'permissionCode' | 'outcome' | 'message'>>;
export function recordEvent(services: Pick<Services, 'repositories' | 'identity' | 'clock'>, actor: FleetActor | null, requestId: string, intent: AuditIntent) {
  return services.repositories.auditEvent.insert({
    id: services.identity.id(), requestId, actorKind: actor?.kind ?? 'system', actorPrincipalId: actor && actor.kind !== 'controller' ? actor.principalId : null,
    actorCredentialId: actor?.kind === 'controller' ? actor.credentialId : null,
    ownerId: intent.ownerId ?? null, targetKind: intent.targetKind, targetId: intent.targetId,
    roomId: intent.roomId ?? null, membershipGeneration: intent.membershipGeneration ?? null,
    authorizerId: intent.authorizerId ?? null, addedById: intent.addedById ?? null, permissionCode: intent.permissionCode ?? null,
    action: intent.action, outcome: intent.outcome ?? 'accepted', message: intent.message ?? '', createdAt: services.clock.now(),
  });
}
