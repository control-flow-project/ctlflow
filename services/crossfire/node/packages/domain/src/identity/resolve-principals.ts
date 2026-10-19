import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Actor, Services } from '../port/services.js';
import type { PrincipalIdentity } from '../port/discovery.js';
import { authorize } from '../authorization/authorize.js';

export function resolvePrincipals(services: Pick<Services, 'repositories' | 'directory' | 'discovery' | 'clock'>,
  actor: Actor, backendUserIds: string[]) {
  const permitted = authorize(services, actor, 'principal.read');
  if (!permitted.ok) return permitted;
  if (!backendUserIds.length || backendUserIds.length > 100 || new Set(backendUserIds).size !== backendUserIds.length) {
    return failure('invalid', 'Resolve 1–100 unique backend identities');
  }
  const resolved = services.discovery.identities(backendUserIds);
  if (!resolved.ok) return resolved;
  const identities = new Map(resolved.value.map(identity => [identity.backendUserId, identity]));
  return success(backendUserIds.map((backendUserId): PrincipalIdentity => identities.get(backendUserId)
    ?? { backendUserId, kind: 'unknown', ownerBackendUserId: null, displayName: null, ownerDisplayName: null }));
}
