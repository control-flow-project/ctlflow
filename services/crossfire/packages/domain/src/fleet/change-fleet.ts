import { failure } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import { validateController, type ControllerDescriptor } from '../enrollment/input.js';
import { authorizeFleet, type FleetActor } from './authority.js';
import { recordEvent } from '../audit/record-event.js';
import { readFleet } from './read-fleet.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'unitOfWork' | 'identity' | 'clock' | 'discovery' | 'runtime' | 'listenerRead'>;
export function changeFleet(services: Dependencies, actor: FleetActor, fleetId: string,
  input: { expectedRevision: number; label: string; controller: ControllerDescriptor }, requestId: string) {
  const valid = validateController(input.controller);
  if (!valid.ok) return valid;
  if (!input.label.trim() || input.label.length > 100) return failure('invalid', 'Fleet label must contain 1–100 characters');
  return services.unitOfWork.run(() => {
    const found = services.repositories.fleet.findById(fleetId); if (!found.ok) return found;
    if (!found.value) return failure('missing', 'Fleet not found');
    const access = authorizeFleet(services, actor, found.value, true); if (!access.ok) return access;
    if (found.value.revision !== input.expectedRevision) return failure('stale_revision', 'Fleet changed; refresh before saving');
    const metadata = services.collection.fleetMetadata([fleetId]); if (!metadata.ok) return metadata;
    for (const entry of metadata.value) { const removed = services.repositories.fleetControllerMetadata.remove({ fleetId, key: entry.key }); if (!removed.ok) return removed; }
    for (const [key, value] of Object.entries(input.controller.metadata ?? {})) {
      const saved = services.repositories.fleetControllerMetadata.insert({ fleetId, key, value }); if (!saved.ok) return saved;
    }
    const fleet = { ...found.value, label: input.label, controllerName: input.controller.name, revision: found.value.revision + 1, updatedAt: services.clock.now() };
    const saved = services.repositories.fleet.update(fleet); if (!saved.ok) return saved;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'fleet', targetId: fleetId, ownerId: fleet.ownerId, action: 'fleet.configure' });
    return audit.ok ? readFleet(services, actor, fleetId) : audit;
  });
}
