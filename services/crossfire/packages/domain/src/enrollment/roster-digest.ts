import type { CoordinationPolicy } from '../coordination/values.js';
import type { ControllerDescriptor } from './input.js';

export function enrollmentRosterValue(input: { ownerMatrixId: string; fleetKey: string; controller: ControllerDescriptor;
  instances: { instanceKey: string; name: string; agentId: string | null; coordinationPolicy: CoordinationPolicy }[] }): string {
  return JSON.stringify({ owner: input.ownerMatrixId, fleet: input.fleetKey,
    controller: { name: input.controller.name, metadata: Object.entries(input.controller.metadata ?? {}).sort(([left], [right]) => left.localeCompare(right)) },
    items: input.instances.map(item => [item.instanceKey, item.name, item.agentId,
      { wakeMode: item.coordinationPolicy.wakeMode,
        senders: [...item.coordinationPolicy.senders].sort((left, right) => left.matrixUserId.localeCompare(right.matrixUserId)),
        permissions: [...item.coordinationPolicy.permissions].sort() }]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))) });
}
