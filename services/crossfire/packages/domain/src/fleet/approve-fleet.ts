import { failure, success } from '@crossfire/kernel/result';
import type { Services } from '../port/services.js';
import type { EnrollmentRequest } from '../enrollment/types.js';

export function approveFleet(services: Pick<Services, 'repositories' | 'collection' | 'identity' | 'clock'>, request: EnrollmentRequest) {
  if (request.fleetKey === null) return success(undefined);
  if (!request.controllerName || !request.controllerCredentialHash) return failure('invalid', 'Fleet enrollment requires a controller');
  const previous = services.repositories.fleet.find({ ownerId: request.ownerId, fleetKey: request.fleetKey });
  if (!previous.ok) return previous;
  if (previous.value) return success(undefined);
  const fleet = { id: services.identity.id(), deliveryEnabled: true, ownerId: request.ownerId, fleetKey: request.fleetKey, label: request.fleetKey,
    controllerName: request.controllerName, revision: 0, createdAt: services.clock.now(), updatedAt: services.clock.now() };
  const saved = services.repositories.fleet.insert(fleet);
  if (!saved.ok) return saved;
  const metadata = services.collection.enrollmentMetadata(request.id);
  if (!metadata.ok) return metadata;
  for (const entry of metadata.value) {
    const saved = services.repositories.fleetControllerMetadata.insert({ fleetId: fleet.id, ...entry });
    if (!saved.ok) return saved;
  }
  return services.repositories.fleetCredential.insert({ id: request.id, fleetId: fleet.id, secretHash: request.controllerCredentialHash, createdAt: services.clock.now(), revokedAt: null });
}
