import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
export function bindRoster(services: Pick<Services, 'repositories' | 'collection' | 'clock'>, ownerId: string, fleetKey: string,
  entries: { instanceKey: string; agentId: string | null }[]) {
  const fleet = services.repositories.fleet.find({ ownerId, fleetKey }); if (!fleet.ok) return fleet;
  if (!fleet.value) return failure('missing', 'Fleet has not been approved');
  const existing = services.collection.fleetInstances({ ownerId, fleetKey }); if (!existing.ok) return existing;
  let size = existing.value.length, changed = false;
  for (const entry of entries) {
    if (entry.agentId === null) return failure('conflict', 'Approved roster identity is missing: ' + entry.instanceKey);
    const authoritative = services.repositories.fleetInstance.findByAgent(entry.agentId); if (!authoritative.ok) return authoritative;
    if (authoritative.value && (authoritative.value.ownerId !== ownerId || authoritative.value.fleetKey !== fleetKey || authoritative.value.instanceKey !== entry.instanceKey))
      return failure('conflict', 'Agent already belongs to another fleet instance');
    const key = { ownerId, fleetKey, instanceKey: entry.instanceKey };
    const previous = services.repositories.fleetInstance.find(key); if (!previous.ok) return previous;
    if (previous.value && previous.value.agentId !== entry.agentId) return failure('conflict', 'Fleet instance identity changed: ' + entry.instanceKey);
    if (!previous.value) {
      if (++size > 100) return failure('capacity', 'A fleet supports at most 100 instances');
      const saved = services.repositories.fleetInstance.insert({ ...key, agentId: entry.agentId, retiredAt: null }); if (!saved.ok) return saved;
      changed = true;
    } else if (previous.value.retiredAt !== null) {
      if (++size > 100) return failure('capacity', 'A fleet supports at most 100 current instances');
      const saved = services.repositories.fleetInstance.update({ ...previous.value, retiredAt: null }); if (!saved.ok) return saved;
      changed = true;
    }
  }
  return changed ? services.repositories.fleet.update({ ...fleet.value, revision: fleet.value.revision + 1, updatedAt: services.clock.now() }) : success(undefined);
}
