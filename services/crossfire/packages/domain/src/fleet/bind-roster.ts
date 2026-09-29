import { failure, success } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
export function bindRoster(services: Pick<Services, 'repositories' | 'collection' | 'clock'>, ownerId: string, fleetKey: string,
  entries: { instanceKey: string; agentId: string | null; outcome: string }[]) {
  const fleet = services.repositories.fleet.find({ ownerId, fleetKey }); if (!fleet.ok) return fleet;
  if (!fleet.value) return failure('missing', 'Fleet has not been approved');
  const existing = services.collection.fleetInstances({ ownerId, fleetKey }); if (!existing.ok) return existing;
  let size = existing.value.length, changed = false;
  for (const entry of entries) {
    if (entry.outcome === 'failed' || entry.agentId === null) continue;
    const key = { ownerId, fleetKey, instanceKey: entry.instanceKey };
    const previous = services.repositories.fleetInstance.find(key); if (!previous.ok) return previous;
    if (previous.value && previous.value.agentId !== entry.agentId) return failure('conflict', 'Fleet instance identity changed: ' + entry.instanceKey);
    if (!previous.value) {
      if (++size > 100) return failure('capacity', 'A fleet supports at most 100 instances');
      const saved = services.repositories.fleetInstance.insert({ ...key, agentId: entry.agentId }); if (!saved.ok) return saved;
      changed = true;
    }
  }
  return changed ? services.repositories.fleet.update({ ...fleet.value, revision: fleet.value.revision + 1, updatedAt: services.clock.now() }) : success(undefined);
}
