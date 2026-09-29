import { failure, success } from '../../../kernel/src/result.js';
import type { Services, Actor } from '../port/services.js';
import type { PageRequest } from '../port/directory.js';
import { ownerScope } from '../authorization/read-scope.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'clock'>;
export function listEnrollments(services: Dependencies, actor: Actor, input: PageRequest & { ownerId?: string }) {
  const scope = ownerScope(services, actor, 'enrollment.read', input.ownerId);
  return scope.ok ? services.collection.enrollments({ ...input, ...scope.value }) : scope;
}
export function readEnrollment(services: Dependencies, actor: Actor, enrollmentId: string) {
  const request = services.repositories.enrollmentRequest.find({ id: enrollmentId });
  if (!request.ok) return request;
  if (!request.value) return failure('missing', 'Enrollment not found');
  const scope = ownerScope(services, actor, 'enrollment.read', request.value.ownerId);
  if (!scope.ok) return scope;
  const instances = services.collection.enrollmentItems({ requestId: enrollmentId });
  return instances.ok ? success({ request: request.value, instances: instances.value }) : instances;
}
