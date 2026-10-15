import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { Fleet } from '../enrollment/types.js';
import { authorizeFleet, type FleetActor } from './authority.js';
import { CONTROLLER_LEASE_MS, type FleetConnection, type FleetControlView, type FleetConnectionView } from './control-types.js';
import { recordEvent } from '../audit/record-event.js';

export type FleetControlServices = Pick<Services, 'repositories' | 'directory' | 'collection' | 'unitOfWork' | 'clock' | 'identity'>;
export function connectionView(connection: FleetConnection | null, now: number): FleetConnectionView {
  return { status: connection && connection.closedAt === null && connection.expiresAt > now ? 'online' : 'offline', lastSeenAt: connection?.lastSeenAt ?? null };
}
export function controlView(fleet: Fleet, connection: FleetConnection | null, now: number): FleetControlView {
  return { fleetId: fleet.id, revision: fleet.revision, deliveryEnabled: fleet.deliveryEnabled, connection: connectionView(connection, now) };
}
export function authorizedFleet(services: FleetControlServices, actor: FleetActor, fleetId: string, write = false) {
  if (actor.kind === 'agent') return failure('forbidden', 'Only the fleet owner, an administrator or its controller may control this fleet');
  const found = services.repositories.fleet.findById(fleetId);
  if (!found.ok) return found;
  if (!found.value) return failure('missing', 'Fleet not found');
  const access = authorizeFleet(services, actor, found.value, write);
  return access.ok ? success(found.value) : access;
}
export function changeFleetDelivery(services: FleetControlServices, actor: FleetActor, fleetId: string,
  input: { expectedRevision: number; enabled: boolean }, requestId: string) {
  return services.unitOfWork.run(() => {
    const found = authorizedFleet(services, actor, fleetId, true); if (!found.ok) return found;
    if (found.value.revision !== input.expectedRevision) return failure('stale_revision', 'Refresh the fleet before changing delivery');
    const fleet = { ...found.value, deliveryEnabled: input.enabled, revision: found.value.revision + 1, updatedAt: services.clock.now() };
    const saved = services.repositories.fleet.update(fleet); if (!saved.ok) return saved;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'fleet', targetId: fleetId, ownerId: fleet.ownerId,
      action: input.enabled ? 'fleet.delivery.activate' : 'fleet.delivery.deactivate' });
    if (!audit.ok) return audit;
    const connection = services.repositories.fleetConnection.find(fleetId);
    return connection.ok ? success(controlView(fleet, connection.value, services.clock.now())) : connection;
  });
}
export function reportFleetConnection(services: FleetControlServices, actor: FleetActor, fleetId: string, connectionId: string, stopped: boolean) {
  if (actor.kind !== 'controller') return failure('forbidden', 'Only this fleet controller can report its connection');
  return services.unitOfWork.run(() => {
    const fleet = authorizedFleet(services, actor, fleetId); if (!fleet.ok) return fleet;
    const previous = services.repositories.fleetConnection.find(fleetId); if (!previous.ok) return previous;
    const now = services.clock.now(), current = previous.value;
    if (current && current.connectionId !== connectionId && current.closedAt === null && current.expiresAt > now) {
      return failure('conflict', 'Another live controller owns this fleet connection');
    }
    if (stopped && (!current || current.connectionId !== connectionId || current.credentialId !== actor.credentialId)) return failure('conflict', 'This controller generation does not own the connection');
    if (!stopped && current?.connectionId === connectionId && (current.closedAt !== null || current.expiresAt <= now || current.credentialId !== actor.credentialId)) {
      return failure('conflict', 'Use a fresh controller connection generation');
    }
    const connection = { fleetId, connectionId, credentialId: actor.credentialId, lastSeenAt: now,
      expiresAt: now + CONTROLLER_LEASE_MS, closedAt: stopped ? now : null };
    const saved = services.repositories.fleetConnection.save(connection);
    return saved.ok ? success(controlView(fleet.value, connection, now)) : saved;
  });
}
export function liveFleetConnection(services: FleetControlServices, actor: FleetActor, fleetId: string, connectionId: string) {
  if (actor.kind !== 'controller') return failure('forbidden', 'A live fleet controller connection is required');
  const fleet = authorizedFleet(services, actor, fleetId); if (!fleet.ok) return fleet;
  const connection = services.repositories.fleetConnection.find(fleetId); if (!connection.ok) return connection;
  if (!connection.value || connection.value.connectionId !== connectionId || connection.value.credentialId !== actor.credentialId
    || connection.value.closedAt !== null || connection.value.expiresAt <= services.clock.now()) return failure('conflict', 'Controller connection expired or was replaced');
  return success({ fleet: fleet.value, connection: connection.value });
}
