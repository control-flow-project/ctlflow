import type { CoordinationPolicy } from '../coordination/values.js';
import type { ControllerDescriptor } from './input.js';

const ordering = new Intl.Collator('en-US');

export function enrollmentRosterValue(input: { ownerMatrixId: string; fleetKey: string; controller: ControllerDescriptor;
  instances: { instanceKey: string; name: string; agentId: string | null; coordinationPolicy: CoordinationPolicy }[] }): string {
  return JSON.stringify({ owner: input.ownerMatrixId, fleet: input.fleetKey,
    controller: { name: input.controller.name, metadata: Object.entries(input.controller.metadata ?? {}).sort(([left], [right]) => ordering.compare(left, right)) },
    items: input.instances.map(item => [item.instanceKey, item.name, item.agentId,
      { wakeMode: item.coordinationPolicy.wakeMode,
        senders: [...item.coordinationPolicy.senders].sort((left, right) => ordering.compare(left.matrixUserId, right.matrixUserId)),
        permissions: [...item.coordinationPolicy.permissions].sort() }]).sort((left, right) => ordering.compare(String(left[0]), String(right[0]))) });
}
