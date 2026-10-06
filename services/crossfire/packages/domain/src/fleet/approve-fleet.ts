import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services } from '../port/services.js';
import type { EnrollmentRequest } from '../enrollment/types.js';

export function approveFleet(services: Pick<Services, 'repositories' | 'collection' | 'identity' | 'clock'>, request: EnrollmentRequest) {
  if (!request.controllerName || !request.controllerCredentialHash) return failure('invalid', 'Fleet enrollment requires a controller');
  const previous = services.repositories.fleet.find({ ownerId: request.ownerId, fleetKey: request.fleetKey });
  if (!previous.ok) return previous;
  if (previous.value && previous.value.archivedAt === null) return success(undefined);
  const fleet = previous.value ? { ...previous.value, archivedAt: null, deliveryEnabled: true, controllerName: request.controllerName,
    revision: previous.value.revision + 1, updatedAt: services.clock.now() } : { id: services.identity.id(), archivedAt: null, deliveryEnabled: true, ownerId: request.ownerId, fleetKey: request.fleetKey, label: request.fleetKey,
    controllerName: request.controllerName, revision: 0, createdAt: services.clock.now(), updatedAt: services.clock.now() };
  const saved = previous.value ? services.repositories.fleet.update(fleet) : services.repositories.fleet.insert(fleet);
  if (!saved.ok) return saved;
  const metadata = services.collection.enrollmentMetadata(request.id);
  if (!metadata.ok) return metadata;
  for (const entry of metadata.value) {
    const existing = services.repositories.fleetControllerMetadata.find({ fleetId: fleet.id, key: entry.key }); if (!existing.ok) return existing;
    const saved = existing.value ? services.repositories.fleetControllerMetadata.update({ fleetId: fleet.id, ...entry })
      : services.repositories.fleetControllerMetadata.insert({ fleetId: fleet.id, ...entry });
    if (!saved.ok) return saved;
  }
  return services.repositories.fleetCredential.insert({ id: request.id, fleetId: fleet.id, secretHash: request.controllerCredentialHash, createdAt: services.clock.now(), revokedAt: null });
}
