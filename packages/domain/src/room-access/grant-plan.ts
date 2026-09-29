import { failure, success, type Result } from '../../../kernel/src/result.js';
import type { Services, Actor } from '../port/services.js';
import type { GrantIntent, GrantAuthorization } from './authorize-change.js';
import { authorizeGrantChange } from './authorize-change.js';
import { authorizeAgent } from '../authorization/authorize.js';
import { commitGrantChange, recheckGrantAuthorization } from './commit-change.js';

export type GrantPlan = { fleetKey: string; agents: { instanceKey: string; grants: (GrantIntent & { roomId: string })[] }[] };
export type GrantPlanSnapshot = { agentId: string; revision: number; grants: { roomId: string; generation: string; revision: number }[] };
export type GrantPlanPreview = { digest: string; snapshots: GrantPlanSnapshot[]; changes: GrantAuthorization[] };
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'identity' | 'clock' | 'matrix' | 'unitOfWork'>;

export async function previewGrantPlan(services: Dependencies, actor: Actor, plan: GrantPlan): Promise<Result<GrantPlanPreview>> {
  if (actor.kind !== 'human') return failure('forbidden', 'Only a human can review a fleet room plan');
  if (!plan.agents.length || plan.agents.length > 100 || new Set(plan.agents.map(agent => agent.instanceKey)).size !== plan.agents.length) return failure('invalid', 'Choose 1–100 unique fleet instances');
  const changes: GrantAuthorization[] = [], snapshots: GrantPlanSnapshot[] = [];
  for (const proposed of [...plan.agents].sort((left, right) => left.instanceKey.localeCompare(right.instanceKey))) {
    if (proposed.grants.length > 100 || new Set(proposed.grants.map(grant => grant.roomId)).size !== proposed.grants.length
      || proposed.grants.some(grant => grant.accessMode === 'none')) return failure('invalid', 'A room plan lists up to 100 unique active grants per agent');
    const binding = services.repositories.fleetInstance.find({ ownerId: actor.principalId, fleetKey: plan.fleetKey, instanceKey: proposed.instanceKey });
    if (!binding.ok) return binding;
    if (!binding.value) return failure('missing', 'Fleet instance is not registered: ' + proposed.instanceKey);
    const target = authorizeAgent(services, actor, binding.value.agentId, 'room-grant.manage');
    if (!target.ok) return target;
    const current = services.collection.roomGrants({ agentId: binding.value.agentId });
    if (!current.ok) return current;
    snapshots.push({ agentId: binding.value.agentId, revision: target.value.principal.revision,
      grants: current.value.map(grant => ({ roomId: grant.roomId, generation: grant.generation, revision: grant.revision })).sort((left, right) => left.roomId.localeCompare(right.roomId)) });
    const rooms = [...new Set([...current.value.map(grant => grant.roomId), ...proposed.grants.map(grant => grant.roomId)])].sort();
    for (const roomId of rooms) {
      const previous = current.value.find(grant => grant.roomId === roomId);
      const next = proposed.grants.find(grant => grant.roomId === roomId) ?? { accessMode: 'none' as const, powerLevel: null, muted: false };
      const authorized = await authorizeGrantChange(services, actor, { ...next, agentId: binding.value.agentId, roomId,
        expectedRevision: target.value.principal.revision, expectedGeneration: previous?.generation ?? null });
      if (!authorized.ok) return authorized;
      changes.push(authorized.value);
    }
  }
  const digest = services.identity.hash(JSON.stringify({ fleetKey: plan.fleetKey, snapshots,
    changes: changes.map(change => ({ input: change.input, authorizerId: change.authorizerId,
      native: change.native ? { powerLevel: change.native.powerLevel, creator: change.native.creator,
        readLevel: change.native.readLevel, replyLevel: change.native.replyLevel } : null })) }));
  return success({ digest, snapshots, changes });
}
export async function applyGrantPlan(services: Dependencies, actor: Actor,
  input: { plan: GrantPlan; digest: string; snapshots: GrantPlanSnapshot[] }, requestId: string) {
  const preview = await previewGrantPlan(services, actor, input.plan);
  if (!preview.ok) return preview;
  if (preview.value.digest !== input.digest || JSON.stringify(preview.value.snapshots) !== JSON.stringify(input.snapshots)) return failure('conflict', 'Room plan, native authority or revisions changed; review a new preview');
  return services.unitOfWork.run(() => {
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
