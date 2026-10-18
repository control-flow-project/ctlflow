import type { ListenerRun } from '../activity/types.js';
import type { Fleet, FleetCredential, FleetInstance } from '../enrollment/types.js';
import type { FleetConnection } from '../fleet/control-types.js';
import type { Principal } from '../identity/types.js';

export type ControllerAdmissionFacts = {
  binding: Pick<FleetInstance, 'ownerId' | 'fleetKey' | 'retiredAt'>;
  fleet: Pick<Fleet, 'id' | 'ownerId' | 'fleetKey' | 'archivedAt' | 'deliveryEnabled'>;
  connection: Pick<FleetConnection, 'connectionId' | 'credentialId' | 'closedAt' | 'expiresAt'>;
  credential: Pick<FleetCredential, 'fleetId' | 'revokedAt'>;
  ownerStatus: Principal['status'];
};
export type ControllerPurpose = 'reporting' | 'delivery';

export function admitsController(run: Pick<ListenerRun, 'controller'>, facts: ControllerAdmissionFacts | null, now: number, purpose: ControllerPurpose): boolean {
  if (!run.controller || !facts) return false;
  const { binding, fleet, connection, credential, ownerStatus } = facts;
  return ownerStatus === 'active' && binding.retiredAt === null && fleet.archivedAt === null
    && binding.ownerId === fleet.ownerId && binding.fleetKey === fleet.fleetKey
    && fleet.id === run.controller.fleetId && (purpose === 'reporting' || fleet.deliveryEnabled)
    && connection.connectionId === run.controller.connectionId && connection.credentialId === run.controller.credentialId
    && connection.closedAt === null && connection.expiresAt > now
    && credential.fleetId === fleet.id && credential.revokedAt === null;
}
