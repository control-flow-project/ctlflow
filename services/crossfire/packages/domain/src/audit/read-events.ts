import type { Services, Actor } from '../port/services.js';
import type { PageRequest } from '../port/directory.js';
import { ownerScope } from '../authorization/read-scope.js';
export function readAuditEvents(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'clock'>, actor: Actor, input: PageRequest & { ownerId?: string }) {
  const scope = ownerScope(services, actor, 'audit.read', input.ownerId);
  return scope.ok ? services.collection.audits({ ...input, ...scope.value }) : scope;
}
