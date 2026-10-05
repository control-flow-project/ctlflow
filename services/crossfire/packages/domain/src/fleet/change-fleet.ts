import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import { validateController, type ControllerDescriptor } from '../enrollment/input.js';
import { authorizeFleet, type FleetActor } from './authority.js';
import { recordEvent } from '../audit/record-event.js';
import { readFleet } from './read-fleet.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'unitOfWork' | 'identity' | 'clock' | 'discovery'>;
export function changeFleet(services: Dependencies, actor: FleetActor, fleetId: string,
  input: { expectedRevision: number; label: string; controller: ControllerDescriptor }, requestId: string) {
  const valid = validateController(input.controller);
  if (!valid.ok) return valid;
  if (!input.label.trim() || input.label.length > 100) return failure('invalid', 'Fleet label must contain 1–100 characters');
  return services.unitOfWork.run(() => {
    const found = services.repositories.fleet.findById(fleetId); if (!found.ok) return found;
    if (!found.value) return failure('missing', 'Fleet not found');
    const access = authorizeFleet(services, actor, found.value, true); if (!access.ok) return access;
    if (found.value.revision !== input.expectedRevision) return failure('stale_revision', 'Fleet changed; refresh before saving');
    const metadata = services.collection.fleetMetadata([fleetId]); if (!metadata.ok) return metadata;
    for (const entry of metadata.value) { const removed = services.repositories.fleetControllerMetadata.remove({ fleetId, key: entry.key }); if (!removed.ok) return removed; }
    for (const [key, value] of Object.entries(input.controller.metadata ?? {})) {
      const saved = services.repositories.fleetControllerMetadata.insert({ fleetId, key, value }); if (!saved.ok) return saved;
    }
    const fleet = { ...found.value, label: input.label, controllerName: input.controller.name, revision: found.value.revision + 1, updatedAt: services.clock.now() };
    const saved = services.repositories.fleet.update(fleet); if (!saved.ok) return saved;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'fleet', targetId: fleetId, ownerId: fleet.ownerId, action: 'fleet.configure' });
    return audit.ok ? readFleet(services, actor, fleetId) : audit;
  });
}
export function removeFleet(services: Dependencies, actor: FleetActor, fleetId: string, expectedRevision: number, requestId: string) {
  return services.unitOfWork.run(() => {
    const found = services.repositories.fleet.findById(fleetId); if (!found.ok) return found;
    if (!found.value) return failure('missing', 'Fleet not found');
    const access = authorizeFleet(services, actor, found.value, true); if (!access.ok) return access;
    if (actor.kind === 'controller') return failure('forbidden', 'Only a human may delete the server fleet');
    if (found.value.revision !== expectedRevision) return failure('stale_revision', 'Fleet changed; refresh before removal');
    const removed = services.repositories.fleet.remove(found.value); if (!removed.ok) return removed;
    return recordEvent(services, actor, requestId, { targetKind: 'fleet', targetId: fleetId, ownerId: found.value.ownerId, action: 'fleet.remove' });
  });
}
export async function bindFleetAgent(services: Dependencies & Pick<Services, 'matrix'>, actor: FleetActor, fleetId: string, agentId: string,
  input: { expectedRevision: number; instanceKey: string; remove: boolean; accessToken?: string }, requestId: string) {
  let verifiedIdentity: string | undefined;
  if (actor.kind === 'controller' && !input.remove) {
    const proof = await services.matrix.identify(input.accessToken ?? ''); if (!proof.ok) return proof;
    verifiedIdentity = proof.value;
  }
  return services.unitOfWork.run(() => {
    if (verifiedIdentity !== undefined) {
      const principal = services.repositories.principal.find({ id: agentId }); if (!principal.ok) return principal;
      if (!principal.value || principal.value.status !== 'active' || principal.value.matrixUserId !== verifiedIdentity) return failure('forbidden', 'Binding requires private proof of this active agent');
    }
    const found = services.repositories.fleet.findById(fleetId); if (!found.ok) return found;
    if (!found.value) return failure('missing', 'Fleet not found');
    const access = authorizeFleet(services, actor, found.value, true); if (!access.ok) return access;
    const target = services.repositories.agent.find({ principalId: agentId }); if (!target.ok) return target;
    if (!target.value || target.value.ownerId !== found.value.ownerId) return failure('forbidden', 'Fleets group only their owner’s agents');
    if (found.value.revision !== input.expectedRevision) return failure('stale_revision', 'Fleet changed; refresh membership');
    const key = { ownerId: found.value.ownerId, fleetKey: found.value.fleetKey, instanceKey: input.instanceKey };
    const previous = services.repositories.fleetInstance.find(key); if (!previous.ok) return previous;
    if (previous.value && previous.value.agentId !== agentId || input.remove && !previous.value) return failure('conflict', 'Instance membership does not match');
    const instances = services.collection.fleetInstances(found.value); if (!instances.ok) return instances;
    if (!input.remove && !previous.value && instances.value.length >= 100) return failure('capacity', 'A fleet supports at most 100 instances');
    const changed = input.remove ? services.repositories.fleetInstance.remove(key) : previous.value ? success(undefined) : services.repositories.fleetInstance.insert({ ...key, agentId });
    if (!changed.ok) return changed;
    const saved = services.repositories.fleet.update({ ...found.value, revision: found.value.revision + 1, updatedAt: services.clock.now() }); if (!saved.ok) return saved;
    return recordEvent(services, actor, requestId, { targetKind: 'agent', targetId: agentId, ownerId: found.value.ownerId, action: input.remove ? 'fleet.agent.remove' : 'fleet.agent.add', message: fleetId + '/' + input.instanceKey });
  });
}
