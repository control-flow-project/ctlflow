import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { BackendAccount } from '../port/messaging.js';
import type { JsonObject } from '@ctlflow/crossfire-kernel/json';
import { registerPrincipal } from '../principal/register.js';
import { recordEvent } from '../audit/record-event.js';
import { acceptMemberInvitation } from './accept-invitation.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'messaging' | 'unitOfWork' | 'identity' | 'clock' | 'instance'>;
export function verifyInvitation(services: Pick<Services, 'repositories' | 'identity' | 'clock'>, id: string, secret: string) {
  const invitation = services.repositories.memberInvitation.find({ id });
  if (!invitation.ok) return invitation;
  return invitation.value && invitation.value.revokedAt === null && invitation.value.consumedByMemberId === null
    && invitation.value.expiresAt > services.clock.now() && services.identity.matches(secret, invitation.value.claimHash)
    ? success(invitation.value) : failure('unauthorized', 'This invitation is invalid, expired or already used');
}
export async function registerMember(services: Dependencies, input: { username: string; password: string; native: JsonObject },
  invitation: { id: string; secret: string } | null, requestId: string): Promise<Result<BackendAccount>> {
  const identity = services.messaging.registrationUserId(input);
  if (!identity.ok) return identity;
  const backendUserId = identity.value;
  if (invitation) {
    const accepted = await acceptMemberInvitation(services, invitation.id, { claimSecret: invitation.secret,
      username: input.username, password: input.password, displayName: input.username }, requestId, input.native);
    return accepted.ok ? success(accepted.value.account) : accepted;
  }
  const policy = services.repositories.instancePolicy.find({ id: 'instance' });
  if (!policy.ok) return policy;
  if (policy.value?.signupMode !== 'open') return failure('forbidden', 'An invitation link is required to create an account');
  const exists = await services.messaging.exists(backendUserId);
  if (!exists.ok) return exists;
  if (exists.value) return failure('conflict', 'This username is already registered');
  const account = await services.messaging.provision(backendUserId, input.password, input.native);
  if (!account.ok) return account;
  const registered = services.unitOfWork.run(() => {
    const current = services.repositories.instancePolicy.find({ id: 'instance' });
    if (!current.ok) return current;
    if (current.value?.signupMode !== 'open') return failure('forbidden', 'Open signup was disabled during registration');
    const existing = services.directory.principalByBackendUserId(backendUserId);
    if (!existing.ok) return existing;
    if (existing.value) return failure('conflict', 'This account is already registered');
    const id = services.identity.id();
    const principal = registerPrincipal(services, { id, backendUserId, kind: 'human', status: 'active', revision: 0, createdAt: services.clock.now() }, 'member', null);
    if (!principal.ok) return principal;
    const member = services.repositories.member.insert({ principalId: id, principalKind: 'human', displayName: input.username });
    if (!member.ok) return member;
    return recordEvent(services, null, requestId, { targetKind: 'member', targetId: id, ownerId: id, action: 'member.register' });
  });
  if (!registered.ok) {
    const discarded = await services.messaging.discard(backendUserId);
    return discarded.ok ? registered : failure('native', 'Registration could not finish; native account cleanup failed');
  }
  return account;
}
