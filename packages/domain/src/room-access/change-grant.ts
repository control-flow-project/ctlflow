import { failure, success } from '../../../kernel/src/result.js';
import type { Services, Actor } from '../port/services.js';
import { authorizeGrantChange, type GrantChange } from './authorize-change.js';
import { commitGrantChange, recheckGrantAuthorization } from './commit-change.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'identity' | 'clock' | 'matrix' | 'unitOfWork'>;
export async function changeRoomGrant(services: Dependencies, actor: Actor, input: GrantChange, requestId: string) {
  const authorized = await authorizeGrantChange(services, actor, input);
  if (!authorized.ok) return authorized;
  return services.unitOfWork.run(() => {
    const rechecked = recheckGrantAuthorization(services, actor, authorized.value);
    if (!rechecked.ok) return rechecked;
    const grants = services.collection.roomGrants({ agentId: input.agentId });
    if (!grants.ok) return grants;
    if (input.accessMode !== 'none' && (!authorized.value.previous || authorized.value.previous.accessMode === 'none')
      && grants.value.filter(grant => grant.accessMode !== 'none').length >= 100) return failure('limit', 'An agent can have at most 100 room grants');
    const saved = commitGrantChange(services, actor, authorized.value, requestId);
    if (!saved.ok) return saved;
    if (!authorized.value.changed) return success({ grant: saved.value, revision: input.expectedRevision });
    const principal = services.repositories.principal.find({ id: input.agentId });
    if (!principal.ok) return principal;
    if (!principal.value) return failure('missing', 'Agent not found');
    const revised = services.repositories.principal.update({ ...principal.value, revision: principal.value.revision + 1 });
    return revised.ok ? success({ grant: saved.value, revision: principal.value.revision + 1 }) : revised;
  });
}
