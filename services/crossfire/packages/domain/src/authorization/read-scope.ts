import { failure, success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import { activeActor } from './authorize.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'clock'>;
export function ownerScope(services: Dependencies, actor: Actor, permission: 'agent.read' | 'enrollment.read' | 'audit.read', requestedOwnerId?: string) {
  const current = activeActor(services, actor);
  if (!current.ok) return current;
  const permissions = services.directory.permissions(actor.principalId);
  if (!permissions.ok) return permissions;
  if (permissions.value.includes(permission + '.any')) return success(requestedOwnerId === undefined ? {} : { ownerId: requestedOwnerId });
  if (!permissions.value.includes(permission + '.owned') || requestedOwnerId !== undefined && requestedOwnerId !== actor.principalId) return failure('forbidden', 'This owner scope is not permitted');
  return success({ ownerId: actor.principalId });
}
