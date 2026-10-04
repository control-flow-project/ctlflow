import { failure, success } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { PageRequest } from '../port/directory.js';
import { ownerScope } from '../authorization/read-scope.js';
import { enrollmentOverviews } from './overview.js';
import { enrollmentItemViews } from './item-view.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'discovery' | 'clock'>;
export function listEnrollments(services: Dependencies, actor: Actor, input: PageRequest & { ownerId?: string }) {
  const scope = ownerScope(services, actor, 'enrollment.read', input.ownerId);
  if (!scope.ok) return scope;
  const page = services.collection.enrollments({ ...input, ...scope.value });
  if (!page.ok) return page;
  const items = enrollmentOverviews(services, page.value.items);
  return items.ok ? success({ ...page.value, items: items.value }) : items;
}
export function readEnrollment(services: Dependencies, actor: Actor, enrollmentId: string) {
  const request = services.repositories.enrollmentRequest.find({ id: enrollmentId });
  if (!request.ok) return request;
  if (!request.value) return failure('missing', 'Enrollment not found');
  const scope = ownerScope(services, actor, 'enrollment.read', request.value.ownerId);
  if (!scope.ok) return scope;
  const overview = enrollmentOverviews(services, [request.value]);
  if (!overview.ok) return overview;
  const instances = services.collection.enrollmentItems({ requestId: enrollmentId });
  if (!instances.ok) return instances;
  const views = enrollmentItemViews(services, instances.value);
  return views.ok ? success({ ...overview.value[0]!, instances: views.value }) : views;
}
