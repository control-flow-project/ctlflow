import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { RequestedFleetPolicy } from '../port/fleet-policy.js';
import type { CoordinationPolicy } from './coordination-policy.js';
import { replaceWakePolicy, validateWakeSenders } from '../wake/replace-policy.js';
import { assignRoomPermissions } from '../room-access/assign-permissions.js';
import { privateConversation } from '../owner-conversation/protect.js';
import { recordEvent } from '../audit/record-event.js';

type ReadDependencies = Pick<Services, 'repositories' | 'directory' | 'collection'>;
type Dependencies = ReadDependencies & Pick<Services, 'clock' | 'identity' | 'runtime'>;

export function resolveCoordinationPolicy(services: ReadDependencies, policy: CoordinationPolicy,
  agentId: string | null, expectedAgentRevision: number | null): Result<RequestedFleetPolicy> {
  const senderIds: string[] = [];
  for (const matrixId of policy.senderMatrixIds) {
    const sender = services.directory.principalByMatrixId(matrixId);
    if (!sender.ok) return sender;
    if (!sender.value) return failure('invalid', 'Selected identity is not registered: ' + matrixId);
    senderIds.push(sender.value.id);
  }
  const valid = validateWakeSenders(services, agentId, policy.wakeMode, senderIds);
  return valid.ok ? success({ wakeMode: policy.wakeMode, senderIds: senderIds.sort(),
    permissions: [...policy.permissions].sort(), expectedAgentRevision }) : valid;
}

export function coordinationPolicyMatches(services: ReadDependencies, agentId: string, requested: RequestedFleetPolicy): Result<boolean> {
  const agent = services.repositories.agent.find({ principalId: agentId });
  const policy = services.repositories.fleetPolicy.approved(agentId);
  const senders = services.collection.wakeSenders({ agentId });
  if (!agent.ok) return agent; if (!policy.ok) return policy; if (!senders.ok) return senders;
  return success(agent.value !== null && policy.value !== null && policy.value.approvedByMemberId === agent.value.ownerId
    && agent.value.wakeMode === requested.wakeMode
    && policy.value.permissions.length === requested.permissions.length
    && policy.value.permissions.every(code => requested.permissions.includes(code))
    && senders.value.length === requested.senderIds.length
    && senders.value.every(sender => requested.senderIds.includes(sender.senderPrincipalId)));
}

export function applyFleetRoomPermissions(services: Dependencies, grant: import('../room-access/types.js').AgentRoomGrant) {
  const policy = services.repositories.fleetPolicy.approved(grant.agentId);
  if (!policy.ok) return policy;
  if (!policy.value || grant.accessMode === 'none') return success(undefined);
  const conversation = privateConversation(services, grant.roomId);
  if (!conversation.ok) return conversation;
  if (conversation.value) return success(undefined);
  const owner = services.repositories.principal.find({ id: policy.value.approvedByMemberId });
  if (!owner.ok) return owner;
  if (!owner.value || owner.value.status !== 'active') return failure('forbidden', 'The fleet policy owner must be active');
  return assignRoomPermissions(services, grant, policy.value.permissions, policy.value.approvedByMemberId);
}

export function applyCoordinationPolicy(services: Dependencies, actor: Actor, agentId: string,
  requested: RequestedFleetPolicy, requestId: string) {
  const current = services.directory.agent(agentId);
  if (!current.ok) return current;
  if (!current.value || actor.kind !== 'human' || current.value.agent.ownerId !== actor.principalId
    || current.value.principal.status !== 'active' || current.value.owner.status !== 'active') return failure('forbidden', 'Only the active owner may approve fleet coordination');
  if (requested.expectedAgentRevision !== null && current.value.principal.revision !== requested.expectedAgentRevision) return failure('conflict', 'Agent configuration changed; submit a new fleet request');
  const matches = coordinationPolicyMatches(services, agentId, requested);
  if (!matches.ok) return matches;
  if (matches.value) return success(undefined);
  const wake = replaceWakePolicy(services, current.value.agent, requested.wakeMode, requested.senderIds);
  if (!wake.ok) return wake;
  const saved = services.repositories.fleetPolicy.approve({ agentId, approvedByMemberId: actor.principalId,
    approvedAt: services.clock.now(), permissions: requested.permissions });
  if (!saved.ok) return saved;
  const grants = services.collection.roomGrants({ agentId });
  if (!grants.ok) return grants;
  for (const grant of grants.value) {
    const conversation = privateConversation(services, grant.roomId);
    if (!conversation.ok) return conversation;
    if (grant.accessMode === 'none' || conversation.value) continue;
    const assigned = applyFleetRoomPermissions(services, grant);
    if (!assigned.ok) return assigned;
    const revised = services.repositories.agentRoomGrant.update({ ...grant, revision: grant.revision + 1, updatedAt: services.clock.now() });
    if (!revised.ok) return revised;
  }
  const revised = services.repositories.principal.update({ ...current.value.principal, revision: current.value.principal.revision + 1 });
  if (!revised.ok) return revised;
  return recordEvent(services, actor, requestId, { targetKind: 'agent', targetId: agentId,
    ownerId: actor.principalId, action: 'fleet.coordination-policy.approve' });
}
