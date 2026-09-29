import { failure, success } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
export async function createSession(services: Pick<Services, 'matrix' | 'directory' | 'repositories' | 'collection' | 'unitOfWork' | 'identity' | 'clock'>, nativeAccessToken: string) {
  const identity = await services.matrix.identify(nativeAccessToken);
  if (!identity.ok) return identity;
  return services.unitOfWork.run(() => {
    const principal = services.directory.principalByMatrixId(identity.value);
    if (!principal.ok) return principal;
    if (!principal.value || principal.value.kind !== 'human' || principal.value.status !== 'active') return failure('forbidden', 'An active human membership is required');
    const member = services.directory.member(principal.value.id);
    if (!member.ok) return member;
    if (!member.value) return failure('forbidden', 'An active human membership is required');
    const removed = services.collection.removeExpiredSessions(services.clock.now());
    if (!removed.ok) return removed;
    const count = services.collection.memberSessionCount(principal.value.id, services.clock.now());
    if (!count.ok) return count;
    if (count.value >= 10) return failure('limit', 'End an existing management session before opening another');
    const secret = services.identity.secret(), csrfSecret = services.identity.secret();
    const saved = services.repositories.memberSession.insert({ secretHash: services.identity.hash(secret), memberId: principal.value.id, csrfSecret,
      nativeAccessToken, createdAt: services.clock.now(), expiresAt: services.clock.now() + 8 * 60 * 60 * 1000 });
    if (!saved.ok) return saved;
    const permissions = services.directory.permissions(principal.value.id);
    return permissions.ok ? success({ secret, csrfSecret, member: member.value, permissions: permissions.value }) : permissions;
  });
}
