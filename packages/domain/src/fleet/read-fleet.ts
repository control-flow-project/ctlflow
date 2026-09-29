import { failure, success } from '../../../kernel/src/result.js';
import type { Services, Actor } from '../port/services.js';
import type { PageRequest } from '../port/directory.js';
import { ownerScope } from '../authorization/read-scope.js';
import { readAgent, type AgentDetails } from '../agent/read-agent.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'listenerRead' | 'clock'>;
export function listFleets(services: Dependencies, actor: Actor, input: PageRequest & { ownerId?: string }) {
  const scope = ownerScope(services, actor, 'agent.read', input.ownerId);
  return scope.ok ? services.collection.fleets({ ...input, ...scope.value }) : scope;
}
export function readFleet(services: Dependencies, actor: Actor, ownerId: string, fleetKey: string) {
  const scope = ownerScope(services, actor, 'agent.read', ownerId);
  if (!scope.ok) return scope;
  const fleet = services.repositories.fleet.find({ ownerId, fleetKey }), instances = services.collection.fleetInstances({ ownerId, fleetKey });
  if (!fleet.ok) return fleet; if (!instances.ok) return instances;
  if (!fleet.value) return failure('missing', 'Fleet not found');
  const items: { instanceKey: string; agent: AgentDetails }[] = [];
  for (const instance of instances.value) {
    const agent = readAgent(services, actor, instance.agentId);
    if (!agent.ok) return agent;
    items.push({ instanceKey: instance.instanceKey, agent: agent.value });
  }
  return success({ fleet: fleet.value, instances: items });
}
