import { failure, success } from '@crossfire/kernel/result';
import type { Actor, Services } from '../port/services.js';
import { authorize } from '../authorization/authorize.js';
import type { Fleet } from '../enrollment/types.js';

export type FleetActor = Actor | { kind: 'controller'; fleetId: string; credentialId: string };
export function controllerToken(services: Pick<Services, 'identity'>, enrollmentId: string, claimSecret: string): string {
  return 'fleet.' + enrollmentId + '.' + services.identity.hash('crossfire-controller:' + claimSecret);
}
export function authenticateController(services: Pick<Services, 'repositories' | 'identity'>, token: string) {
  const matched = /^fleet\.([a-f0-9-]{36})\.[a-f0-9]{64}$/u.exec(token);
  if (!matched) return failure('unauthorized', 'Invalid controller credential');
  const found = services.repositories.fleetCredential.find({ id: matched[1]! });
  if (!found.ok) return found;
  if (!found.value || found.value.revokedAt !== null || !services.identity.matches(token, found.value.secretHash)) return failure('unauthorized', 'Invalid controller credential');
  const fleet = services.repositories.fleet.findById(found.value.fleetId);
  if (!fleet.ok) return fleet;
  if (!fleet.value) return failure('unauthorized', 'Fleet is unavailable');
  const owner = services.repositories.principal.find({ id: fleet.value.ownerId });
  if (!owner.ok) return owner;
  return owner.value?.status === 'active' ? success({ kind: 'controller' as const, fleetId: fleet.value.id, credentialId: found.value.id })
    : failure('forbidden', 'Fleet owner is not active');
}
export function authorizeFleet(services: Pick<Services, 'repositories' | 'directory' | 'clock'>, actor: FleetActor, fleet: Fleet, write = false) {
  if (actor.kind === 'controller') {
    const credential = services.repositories.fleetCredential.find({ id: actor.credentialId });
    if (!credential.ok) return credential;
    const owner = services.repositories.principal.find({ id: fleet.ownerId });
    if (!owner.ok) return owner;
    return actor.fleetId === fleet.id && credential.value?.fleetId === fleet.id && credential.value.revokedAt === null && owner.value?.status === 'active'
      ? success(undefined) : failure('forbidden', 'Controller authority does not cover this fleet');
  }
  const own = actor.principalId === fleet.ownerId;
  return authorize(services, actor, write ? own ? 'agent.configure.owned' : 'agent.configure.any' : own ? 'agent.read.owned' : 'agent.read.any');
}
