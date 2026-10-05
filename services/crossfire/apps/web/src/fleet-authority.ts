import type { FleetView, SessionView } from '@ctlflow/crossfire-contracts/schema/response';

export function canManageFleet(viewer: SessionView, fleet: FleetView): boolean {
  return viewer.permissions.includes('agent.configure.any')
    || viewer.permissions.includes('agent.configure.owned') && fleet.owner.matrixUserId === viewer.member.matrixUserId;
}
