import type { FleetView } from '@ctlflow/crossfire-contracts/schema/response';

export function canManageFleet(fleet: FleetView): boolean {
  return fleet.allowedActions.includes('configure');
}
