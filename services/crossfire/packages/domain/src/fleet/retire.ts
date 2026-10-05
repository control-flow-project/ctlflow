import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { FleetInstance } from '../enrollment/types.js';
import { authorizeFleet, type FleetActor } from './authority.js';
import { recordEvent } from '../audit/record-event.js';
import { retirementEligible } from './native-stop.js';
import { liveFleetConnection } from './control.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'listenerRead' | 'runtime' | 'unitOfWork' | 'clock' | 'identity'>;

function retireInstance(services: Dependencies, fleetId: string, instance: FleetInstance) {
  const now = services.clock.now();
  if (instance.retiredAt !== null) return success(undefined);
  const eligible = retirementEligible(services, fleetId, instance.agentId); if (!eligible.ok) return eligible;
  if (!eligible.value) return failure('conflict', 'Stop the native session through its controller and settle all pending receipts before retirement');
  const retired = services.repositories.fleetInstance.update({ ...instance, retiredAt: now }); if (!retired.ok) return retired;
  const principal = services.repositories.principal.find({ id: instance.agentId }); if (!principal.ok) return principal;
  if (!principal.value) return failure('missing', 'Agent identity no longer exists');
  if (principal.value.status === 'active') {
    const suspended = services.repositories.principal.update({ ...principal.value, status: 'suspended', revision: principal.value.revision + 1 }); if (!suspended.ok) return suspended;
    const application = services.repositories.principalApplication.find({ principalId: instance.agentId }); if (!application.ok) return application;
    if (!application.value) return failure('unavailable', 'Agent native account state is missing');
    const scheduled = services.repositories.principalApplication.update({ ...application.value, nextCheckAt: now }); if (!scheduled.ok) return scheduled;
  }
  const runs = services.listenerRead.active([instance.agentId], 0); if (!runs.ok) return runs;
  for (const run of runs.value) {
    const requested = services.repositories.listenerRun.update({ ...run, disconnectRequestedAt: run.disconnectRequestedAt ?? now });
    if (!requested.ok) return requested;
  }
  return success(undefined);
}

export function removeFleetAgent(services: Dependencies, actor: FleetActor, fleetId: string, agentId: string,
  input: { expectedRevision: number; instanceKey: string }, requestId: string) {
  return services.unitOfWork.run(() => {
    const fleet = services.repositories.fleet.findById(fleetId); if (!fleet.ok) return fleet;
    if (!fleet.value || fleet.value.archivedAt !== null) return failure('missing', 'Current fleet not found');
    const authority = authorizeFleet(services, actor, fleet.value, true); if (!authority.ok) return authority;
    if (fleet.value.revision !== input.expectedRevision) return failure('stale_revision', 'Refresh the fleet before retiring an instance');
    const instance = services.repositories.fleetInstance.find({ ...fleet.value, instanceKey: input.instanceKey }); if (!instance.ok) return instance;
    if (!instance.value || instance.value.agentId !== agentId) return failure('conflict', 'Instance membership does not match');
    const retired = retireInstance(services, fleetId, instance.value); if (!retired.ok) return retired;
    const changed = services.repositories.fleet.update({ ...fleet.value, revision: fleet.value.revision + 1, updatedAt: services.clock.now() }); if (!changed.ok) return changed;
    return recordEvent(services, actor, requestId, { targetKind: 'agent', targetId: agentId, ownerId: fleet.value.ownerId,
      action: 'fleet.agent.retire', message: fleetId + '/' + input.instanceKey });
  });
}

export function archiveFleet(services: Dependencies, actor: FleetActor, fleetId: string, expectedRevision: number, requestId: string) {
  return services.unitOfWork.run(() => {
    const fleet = services.repositories.fleet.findById(fleetId); if (!fleet.ok) return fleet;
    if (!fleet.value) return failure('missing', 'Fleet not found');
    const authority = authorizeFleet(services, actor, fleet.value, true); if (!authority.ok) return authority;
    if (actor.kind === 'controller') {
      const connection = services.repositories.fleetConnection.find(fleetId); if (!connection.ok) return connection;
      if (!connection.value) return failure('conflict', 'An authenticated current controller lease is required to archive');
      const live = liveFleetConnection(services, actor, fleetId, connection.value.connectionId); if (!live.ok) return live;
    }
    if (fleet.value.revision !== expectedRevision) return failure('stale_revision', 'Refresh the fleet before archiving');
    const instances = services.collection.fleetInstances(fleet.value); if (!instances.ok) return instances;
    const pending = services.repositories.fleetRuntimeOperation.pending(fleetId); if (!pending.ok) return pending;
    if (pending.value) return failure('conflict', 'Finish the pending session operation before archiving');
    for (const instance of instances.value) { const retired = retireInstance(services, fleetId, instance); if (!retired.ok) return retired; }
    const credentials = services.repositories.fleetCredential.forFleet(fleetId); if (!credentials.ok) return credentials;
    const now = services.clock.now();
    for (const credential of credentials.value) {
      if (credential.revokedAt !== null) continue;
      const revoked = services.repositories.fleetCredential.update({ ...credential, revokedAt: now }); if (!revoked.ok) return revoked;
    }
    const connection = services.repositories.fleetConnection.find(fleetId); if (!connection.ok) return connection;
    if (connection.value && connection.value.closedAt === null) {
      const closed = services.repositories.fleetConnection.save({ ...connection.value, closedAt: now }); if (!closed.ok) return closed;
    }
    const changed = services.repositories.fleet.update({ ...fleet.value, archivedAt: now, deliveryEnabled: false,
      revision: fleet.value.revision + 1, updatedAt: now }); if (!changed.ok) return changed;
    return recordEvent(services, actor, requestId, { targetKind: 'fleet', targetId: fleetId, ownerId: fleet.value.ownerId, action: 'fleet.archive' });
  });
}
