import { failure, success } from '@crossfire/kernel/result';
import type { Actor, Services } from '../port/services.js';
import type { PrincipalIdentity } from '../port/discovery.js';
import { authorize } from '../authorization/authorize.js';

export function resolvePrincipals(services: Pick<Services, 'repositories' | 'directory' | 'discovery' | 'clock'>,
  actor: Actor, matrixUserIds: string[]) {
  const permitted = authorize(services, actor, 'principal.read');
  if (!permitted.ok) return permitted;
  if (!matrixUserIds.length || matrixUserIds.length > 100 || new Set(matrixUserIds).size !== matrixUserIds.length) {
    return failure('invalid', 'Resolve 1–100 unique Matrix identities');
  }
  const resolved = services.discovery.identities(matrixUserIds);
  if (!resolved.ok) return resolved;
  const identities = new Map(resolved.value.map(identity => [identity.matrixUserId, identity]));
  return success(matrixUserIds.map((matrixUserId): PrincipalIdentity => identities.get(matrixUserId)
    ?? { matrixUserId, kind: 'unknown', ownerMatrixId: null }));
}
