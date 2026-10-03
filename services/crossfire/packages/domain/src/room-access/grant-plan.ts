import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { GrantIntent, GrantAuthorization } from './authorize-change.js';
import { authorizeGrantChange } from './authorize-change.js';
import { authorizeAgent } from '../authorization/authorize.js';
import { commitGrantChange, recheckGrantAuthorization } from './commit-change.js';
import { authorizeFleet } from '../fleet/authority.js';
import { readRoom } from '../room/read-room.js';

export type GrantPlan = { fleetId: string; agents: { instanceKey: string; grants: (GrantIntent & { roomId: string })[] }[] };
export type GrantPlanSnapshot = { agentId: string; revision: number; grants: { roomId: string; generation: string; revision: number }[] };
export type GrantPlanChange = GrantAuthorization & { agentName: string; instanceKey: string; roomName: string; roomAlias: string | null };
export type GrantPlanPreview = { digest: string; fleetId: string; fleetRevision: number; snapshots: GrantPlanSnapshot[]; changes: GrantPlanChange[] };
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'identity' | 'clock' | 'matrix' | 'unitOfWork' | 'runtime'>;

export async function previewGrantPlan(services: Dependencies, actor: Actor, plan: GrantPlan): Promise<Result<GrantPlanPreview>> {
  if (actor.kind !== 'human') return failure('forbidden', 'Only a human can review a fleet room plan');
  const fleet = services.repositories.fleet.findById(plan.fleetId);
  if (!fleet.ok) return fleet;
  if (!fleet.value) return failure('missing', 'Fleet not found');
  const access = authorizeFleet(services, actor, fleet.value, true);
  if (!access.ok) return access;
  if (!plan.agents.length || plan.agents.length > 100 || new Set(plan.agents.map(agent => agent.instanceKey)).size !== plan.agents.length) return failure('invalid', 'Choose 1–100 unique fleet instances');
  const changes: GrantPlanChange[] = [], snapshots: GrantPlanSnapshot[] = [];
  for (const proposed of [...plan.agents].sort((left, right) => left.instanceKey.localeCompare(right.instanceKey))) {
    if (proposed.grants.length > 100 || new Set(proposed.grants.map(grant => grant.roomId)).size !== proposed.grants.length
      || proposed.grants.some(grant => grant.accessMode === 'none')) return failure('invalid', 'A room plan lists up to 100 unique active grants per agent');
    const binding = services.repositories.fleetInstance.find({ ownerId: fleet.value.ownerId, fleetKey: fleet.value.fleetKey, instanceKey: proposed.instanceKey });
    if (!binding.ok) return binding;
    if (!binding.value) return failure('missing', 'Fleet instance is not registered: ' + proposed.instanceKey);
    const target = authorizeAgent(services, actor, binding.value.agentId, 'room-grant.manage');
    if (!target.ok) return target;
    const current = services.collection.roomGrants({ agentId: binding.value.agentId });
    const conversation = services.repositories.ownerConversation.find({ agentId: binding.value.agentId });
    if (!current.ok) return current; if (!conversation.ok) return conversation;
    if (proposed.grants.some(grant => grant.roomId === conversation.value?.roomId)) return failure('invalid', 'Owner DMs are built in and must not appear in a room plan');
    snapshots.push({ agentId: binding.value.agentId, revision: target.value.principal.revision,
      grants: current.value.map(grant => ({ roomId: grant.roomId, generation: grant.generation, revision: grant.revision })).sort((left, right) => left.roomId.localeCompare(right.roomId)) });
    const rooms = [...new Set([...current.value.filter(grant => grant.roomId !== conversation.value?.roomId).map(grant => grant.roomId), ...proposed.grants.map(grant => grant.roomId)])].sort();
    for (const roomId of rooms) {
      const previous = current.value.find(grant => grant.roomId === roomId);
      const next = proposed.grants.find(grant => grant.roomId === roomId) ?? { accessMode: 'none' as const, powerLevel: null, muted: false };
      const authorized = await authorizeGrantChange(services, actor, { ...next, agentId: binding.value.agentId, roomId,
        expectedRevision: target.value.principal.revision, expectedGeneration: previous?.generation ?? null });
      if (!authorized.ok) return authorized;
      const facts = authorized.value.native ? success(authorized.value.native) : await readRoom(services, actor, roomId, binding.value.agentId);
      changes.push({ ...authorized.value, agentName: target.value.agent.displayNameOverride ?? target.value.name,
        instanceKey: proposed.instanceKey, roomName: facts.ok ? facts.value.name : roomId, roomAlias: facts.ok ? facts.value.alias : null });
    }
  }
  const current = services.repositories.fleet.findById(plan.fleetId);
  if (!current.ok) return current;
  if (current.value?.revision !== fleet.value.revision) return failure('conflict', 'Fleet changed during review');
  const digest = services.identity.hash(JSON.stringify({ fleetId: plan.fleetId, fleetRevision: fleet.value.revision, snapshots,
    changes: changes.map(change => ({ input: change.input, authorizerId: change.authorizerId,
      native: change.native ? { powerLevel: change.native.powerLevel, creator: change.native.creator,
        readLevel: change.native.readLevel, replyLevel: change.native.replyLevel } : null })) }));
  return success({ digest, fleetId: fleet.value.id, fleetRevision: fleet.value.revision, snapshots, changes });
}
export async function applyGrantPlan(services: Dependencies, actor: Actor,
  input: { plan: GrantPlan; digest: string; snapshots: GrantPlanSnapshot[] }, requestId: string) {
  const preview = await previewGrantPlan(services, actor, input.plan);
  if (!preview.ok) return preview;
  if (preview.value.digest !== input.digest || JSON.stringify(preview.value.snapshots) !== JSON.stringify(input.snapshots)) return failure('conflict', 'Room plan, native authority or revisions changed; review a new preview');
  return services.unitOfWork.run(() => {
    const fleet = services.repositories.fleet.findById(preview.value.fleetId);
    if (!fleet.ok) return fleet;
    if (fleet.value?.revision !== preview.value.fleetRevision) return failure('conflict', 'Fleet changed; review a new preview');
    const access = authorizeFleet(services, actor, fleet.value, true);
    if (!access.ok) return access;
    for (const change of preview.value.changes) {
      const checked = recheckGrantAuthorization(services, actor, change);
      if (!checked.ok) return checked;
    }
    for (const change of preview.value.changes) {
      const saved = commitGrantChange(services, actor, change, requestId);
      if (!saved.ok) return saved;
    }
    for (const snapshot of preview.value.snapshots) {
      if (!preview.value.changes.some(change => change.input.agentId === snapshot.agentId && change.changed)) continue;
      const target = services.repositories.principal.find({ id: snapshot.agentId });
      if (!target.ok) return target;
      if (!target.value || target.value.revision !== snapshot.revision) return failure('conflict', 'Agent revision changed');
      const updated = services.repositories.principal.update({ ...target.value, revision: snapshot.revision + 1 });
      if (!updated.ok) return updated;
    }
    return success({ accepted: true, agents: preview.value.snapshots.map(snapshot => snapshot.agentId) });
  });
}
