import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { PageRequest } from '../port/directory.js';
import { fleetRequesterAuthorized, type FleetActor } from './authority.js';
import { authorizedFleet, connectionView, liveFleetConnection, type FleetControlServices } from './control.js';
import { recordEvent } from '../audit/record-event.js';
import { runtimeOperationView, type RuntimeOperation } from './runtime-types.js';

export function requestFleetRuntime(services: FleetControlServices, actor: FleetActor, fleetId: string,
  input: { operationId: string; agentId: string | null; action: 'start' | 'stop' | 'reset'; expectedRevision: number; confirmFreshHistory: boolean }, requestId: string) {
  if (actor.kind !== 'human') return failure('forbidden', 'Only the fleet owner or an administrator may request session operations');
  if (input.confirmFreshHistory !== (input.action === 'reset')) return failure('invalid', 'Fresh history requires explicit confirmation');
  return services.unitOfWork.run(() => {
    const fleet = authorizedFleet(services, actor, fleetId, true); if (!fleet.ok) return fleet;
    const previous = services.repositories.fleetRuntimeOperation.find(input.operationId); if (!previous.ok) return previous;
    if (previous.value) return previous.value.fleetId === fleetId && previous.value.authorPrincipalId === actor.principalId
      && previous.value.agentId === input.agentId && previous.value.action === input.action && previous.value.expectedRevision === input.expectedRevision
      ? success(runtimeOperationView(previous.value)) : failure('conflict', 'Operation ID belongs to a different session request');
    if (fleet.value.revision !== input.expectedRevision) return failure('stale_revision', 'Refresh the fleet before changing sessions');
    const connection = services.repositories.fleetConnection.find(fleetId); if (!connection.ok) return connection;
    if (connectionView(connection.value, services.clock.now()).status !== 'online') return failure('conflict', 'Connect the fleet controller before changing sessions');
    const instances = services.collection.fleetInstances(fleet.value); if (!instances.ok) return instances;
    if (!instances.value.length || input.agentId !== null && !instances.value.some(instance => instance.agentId === input.agentId)) return failure('missing', 'The target is not an enrolled agent in this fleet');
    const pending = services.repositories.fleetRuntimeOperation.pending(fleetId); if (!pending.ok) return pending;
    if (pending.value) return failure('conflict', 'A session operation is already pending for this fleet');
    const now = services.clock.now();
    const operation: RuntimeOperation = { operationId: input.operationId, action: input.action, agentId: input.agentId, expectedRevision: input.expectedRevision,
      fleetId, authorPrincipalId: actor.principalId, status: 'pending', createdAt: now,
      completedAt: null, errorMessage: null, connectionId: null, credentialId: null };
    const stored = services.repositories.fleetRuntimeOperation.insert(operation); if (!stored.ok) return stored;
    const updated = services.repositories.fleet.update({ ...fleet.value, revision: fleet.value.revision + 1, updatedAt: now }); if (!updated.ok) return updated;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'fleet', targetId: fleetId, ownerId: fleet.value.ownerId,
      action: 'fleet.session.' + input.action, message: input.operationId });
    return audit.ok ? success(runtimeOperationView(operation)) : audit;
  });
}
export function listFleetRuntime(services: FleetControlServices, actor: FleetActor, fleetId: string, page: PageRequest) {
  const fleet = authorizedFleet(services, actor, fleetId); if (!fleet.ok) return fleet;
  const records = services.repositories.fleetRuntimeOperation.page(fleetId, page);
  return records.ok ? success({ ...records.value, items: records.value.items.map(runtimeOperationView) }) : records;
}
export function claimFleetRuntime(services: FleetControlServices, actor: FleetActor, fleetId: string, operationId: string, connectionId: string) {
  return services.unitOfWork.run(() => {
    const current = liveFleetConnection(services, actor, fleetId, connectionId); if (!current.ok) return current;
    const found = services.repositories.fleetRuntimeOperation.find(operationId); if (!found.ok) return found;
    if (!found.value || found.value.fleetId !== fleetId) return failure('missing', 'Session operation not found');
    const operation = found.value;
    if (operation.status === 'succeeded' || operation.status === 'failed') return success(runtimeOperationView(operation));
    const allowed = fleetRequesterAuthorized(services, operation.authorPrincipalId, current.value.fleet); if (!allowed.ok) return allowed;
    const instances = services.collection.fleetInstances(current.value.fleet); if (!instances.ok) return instances;
    const valid = allowed.value && (operation.status !== 'pending' || current.value.fleet.revision === operation.expectedRevision + 1)
      && (operation.agentId === null || instances.value.some(instance => instance.agentId === operation.agentId));
    const next: RuntimeOperation = valid ? { ...operation, status: 'running', connectionId, credentialId: current.value.connection.credentialId }
      : { ...operation, status: 'failed', completedAt: services.clock.now(), errorMessage: operation.status === 'pending'
        ? 'Session request authority or roster changed before execution'
        : 'Session request authority or roster changed after execution was claimed; inspect the controller’s native operation outcome' };
    const stored = services.repositories.fleetRuntimeOperation.update(next);
    return stored.ok ? success(runtimeOperationView(next)) : stored;
  });
}
export function receiptFleetRuntime(services: FleetControlServices, actor: FleetActor, fleetId: string, operationId: string,
  input: { connectionId: string; status: 'succeeded' | 'failed'; errorMessage: string | null }) {
  if ((input.status === 'failed') !== (input.errorMessage !== null)) return failure('invalid', 'Invalid session receipt');
  return services.unitOfWork.run(() => {
    const current = liveFleetConnection(services, actor, fleetId, input.connectionId); if (!current.ok) return current;
    const found = services.repositories.fleetRuntimeOperation.find(operationId); if (!found.ok) return found;
    if (!found.value) return success({ recorded: false });
    if (found.value.fleetId !== fleetId) return failure('missing', 'Session operation not found');
    if (found.value.status === 'succeeded' || found.value.status === 'failed') return found.value.status === input.status && found.value.errorMessage === input.errorMessage
      ? success({ recorded: true }) : failure('conflict', 'This session operation already has a different final outcome');
    if (found.value.status !== 'running' || found.value.connectionId !== input.connectionId || found.value.credentialId !== current.value.connection.credentialId) return failure('conflict', 'Claim this operation on the current controller connection before reporting its outcome');
    const next: RuntimeOperation = { ...found.value, ...input, completedAt: services.clock.now() };
    const stored = services.repositories.fleetRuntimeOperation.update(next);
    if (!stored.ok) return stored;
    return success({ recorded: true });
  });
}
