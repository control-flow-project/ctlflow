import type { Services, Actor } from '../port/services.js';
import type { DiscoveryFilter } from '../port/discovery.js';
import { authorize } from './authorize.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'discovery' | 'clock'>;
export function discoverPrincipals(services: Dependencies, actor: Actor, input: DiscoveryFilter) {
  const permission = authorize(services, actor, 'principal.read');
  return permission.ok ? services.discovery.principals(input) : permission;
}
export function readRoles(services: Dependencies, actor: Actor) {
  const permission = authorize(services, actor, 'principal.read');
  return permission.ok ? services.discovery.roles(actor.kind) : permission;
}
export function readPermissions(services: Dependencies, actor: Actor) {
  const permission = authorize(services, actor, 'principal.read');
  return permission.ok ? services.discovery.permissions() : permission;
}
