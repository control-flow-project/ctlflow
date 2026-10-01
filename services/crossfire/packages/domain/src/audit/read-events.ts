import type { Services, Actor } from '../port/services.js';
import type { PageRequest } from '../port/directory.js';
import { ownerScope } from '../authorization/read-scope.js';
import { success } from '@crossfire/kernel/result';
import type { AuditEvent } from './types.js';
import type { PrincipalSummary } from '../port/discovery.js';
export type AuditEventDetails = AuditEvent & { actor: PrincipalSummary | null; target: PrincipalSummary | null };
export function readAuditEvents(services: Pick<Services, 'repositories' | 'directory' | 'collection' | 'discovery' | 'clock'>, actor: Actor, input: PageRequest & { ownerId?: string }) {
  const scope = ownerScope(services, actor, 'audit.read', input.ownerId);
  if (!scope.ok) return scope;
  const page = services.collection.audits({ ...input, ...scope.value });
  if (!page.ok) return page;
  const ids = [...new Set(page.value.items.flatMap(item => [
    ...(item.actorPrincipalId ? [item.actorPrincipalId] : []),
    ...(item.targetKind === 'agent' || item.targetKind === 'member' ? [item.targetId] : []),
  ]))];
  const selected = ids.length ? services.discovery.selected(ids) : success([]);
  if (!selected.ok) return selected;
  const identities = new Map(selected.value.map(identity => [identity.principalId, identity]));
  const items: AuditEventDetails[] = page.value.items.map(item => ({ ...item,
    actor: item.actorPrincipalId ? identities.get(item.actorPrincipalId) ?? null : null,
    target: item.targetKind === 'agent' || item.targetKind === 'member' ? identities.get(item.targetId) ?? null : null,
  }));
  return success({ ...page.value, items });
}
