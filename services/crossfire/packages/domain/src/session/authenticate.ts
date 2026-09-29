import { failure, success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import { activeActor } from '../authorization/authorize.js';
export async function authenticateMember(services: Pick<Services, 'repositories' | 'directory' | 'matrix' | 'identity' | 'clock'>,
  secret: string, csrfSecret?: string) {
  const session = services.repositories.memberSession.find({ secretHash: services.identity.hash(secret) });
  if (!session.ok) return session;
  if (!session.value || session.value.expiresAt <= services.clock.now()) return failure('unauthorized', 'Management session expired or ended');
  if (csrfSecret !== undefined && csrfSecret !== session.value.csrfSecret) return failure('forbidden', 'CSRF verification failed');
  const identity = await services.matrix.identify(session.value.nativeAccessToken);
  if (!identity.ok) return identity;
  const member = services.directory.member(session.value.memberId);
  if (!member.ok) return member;
  if (!member.value || member.value.principal.matrixUserId !== identity.value) return failure('unauthorized', 'Native session identity changed');
  const actor: Actor = { principalId: session.value.memberId, kind: 'human', sessionHash: session.value.secretHash };
  const checked = activeActor(services, actor);
  if (!checked.ok) return checked;
  const permissions = services.directory.permissions(actor.principalId);
  return permissions.ok ? success({ actor, member: member.value, csrfSecret: session.value.csrfSecret, permissions: permissions.value }) : permissions;
}
export async function authenticateAgent(services: Pick<Services, 'repositories' | 'directory' | 'matrix' | 'clock'>, token: string) {
  const identity = await services.matrix.identify(token);
  if (!identity.ok) return identity;
  const principal = services.directory.principalByMatrixId(identity.value);
  if (!principal.ok) return principal;
  if (!principal.value || principal.value.kind !== 'agent') return failure('forbidden', 'Registered agent authentication is required');
  const actor: Actor = { principalId: principal.value.id, kind: 'agent' };
  const checked = activeActor(services, actor);
  return checked.ok ? success(actor) : checked;
}
export function endSession(services: Pick<Services, 'repositories' | 'identity'>, secret: string) {
  return services.repositories.memberSession.remove({ secretHash: services.identity.hash(secret) });
}
