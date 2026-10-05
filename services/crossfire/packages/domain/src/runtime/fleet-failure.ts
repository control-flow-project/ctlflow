import type { Services } from '../port/services.js';
import type { FleetActor } from '../fleet/authority.js';
import { authorizeFleet } from '../fleet/authority.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { openIncident } from './incidents.js';
import { agentDisplayName } from '../identity/display-name.js';

export function reportFleetFailure(services: Services, actor: FleetActor, fleetId: string,
  input: { episodeId: string; agentId: string; sessionId: string | null; message: string }) {
  return services.unitOfWork.run(() => {
    const fleet = services.repositories.fleet.findById(fleetId);
    if (!fleet.ok) return fleet;
    if (!fleet.value) return failure('missing', 'Fleet not found');
    const authority = authorizeFleet(services, actor, fleet.value, true);
    if (!authority.ok) return authority;
    if (actor.kind !== 'controller') return failure('forbidden', 'An authenticated fleet controller is required');
    const agent = services.directory.agent(input.agentId);
    if (!agent.ok) return agent;
    const instances = services.collection.fleetInstances({ ownerId: fleet.value.ownerId, fleetKey: fleet.value.fleetKey });
    if (!instances.ok) return instances;
    if (!agent.value || agent.value.agent.ownerId !== fleet.value.ownerId || !instances.value.some(instance => instance.agentId === input.agentId)) return failure('missing', 'Fleet instance not found');
    const saved = openIncident(services, { ownerId: fleet.value.ownerId, agentId: input.agentId, fleetId: null, runId: null, sessionId: input.sessionId, kind: 'failure',
      message: agentDisplayName(agent.value.name, agent.value.ownerMember.displayName, agent.value.agent.displayNameOverride) + ' failed: ' + input.message }, input.episodeId);
    return saved.ok ? success({ accepted: true }) : saved;
  });
}
