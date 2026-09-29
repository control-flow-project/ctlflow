import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { PageRequest, Page } from '../port/directory.js';
import type { Fleet } from '../enrollment/types.js';
import { ownerScope } from '../authorization/read-scope.js';
import { readActivity } from '../listener/activity.js';
import { authorizeFleet, type FleetActor } from './authority.js';
import { agentActions, type AgentDetails } from '../agent/read-agent.js';
import type { PrincipalSummary } from '../port/discovery.js';

type Dependencies = Pick<Services, 'repositories' | 'directory' | 'collection' | 'discovery' | 'clock'>;
export type FleetDetails = Fleet & { metadata: Record<string, string>; owner: PrincipalSummary };
export function listFleets(services: Dependencies, actor: Actor, input: PageRequest & { ownerId?: string; search?: string }): Result<Page<FleetDetails>> {
  const scope = ownerScope(services, actor, 'agent.read', input.ownerId);
  if (!scope.ok) return scope;
  const page = services.collection.fleets({ ...input, ...scope.value });
  if (!page.ok) return page;
  const metadata = services.collection.fleetMetadata(page.value.items.map(fleet => fleet.id)); if (!metadata.ok) return metadata;
  const owners = services.discovery.selected([...new Set(page.value.items.map(fleet => fleet.ownerId))]); if (!owners.ok) return owners;
  const byOwner = new Map(owners.value.map(owner => [owner.principalId, owner]));
  if (page.value.items.some(fleet => !byOwner.has(fleet.ownerId))) return failure('unavailable', 'Fleet owner record is missing');
  const entries = new Map<string, [string, string][]>();
  for (const entry of metadata.value) { const group = entries.get(entry.fleetId) ?? []; group.push([entry.key, entry.value]); entries.set(entry.fleetId, group); }
  const items = page.value.items.map(fleet => ({ ...fleet, owner: byOwner.get(fleet.ownerId)!, metadata: Object.fromEntries(entries.get(fleet.id) ?? []) }));
  return success({ ...page.value, items });
}
export function readFleet(services: Dependencies, actor: FleetActor, fleetId: string): Result<FleetDetails> {
  const fleet = services.repositories.fleet.findById(fleetId);
  if (!fleet.ok) return fleet;
  if (!fleet.value) return failure('missing', 'Fleet not found');
  const access = authorizeFleet(services, actor, fleet.value); if (!access.ok) return access;
  const metadata = services.collection.fleetMetadata([fleetId]); if (!metadata.ok) return metadata;
  const owners = services.discovery.selected([fleet.value.ownerId]); if (!owners.ok) return owners;
  const owner = owners.value[0]; if (!owner) return failure('unavailable', 'Fleet owner record is missing');
  return success({ ...fleet.value, owner, metadata: Object.fromEntries(metadata.value.map(entry => [entry.key, entry.value])) });
}
export function listFleetAgents(services: Dependencies & Pick<Services, 'listenerRead' | 'clock'>, actor: FleetActor, fleetId: string, page: PageRequest): Result<Page<{ instanceKey: string; agent: AgentDetails }>> {
  const fleet = readFleet(services, actor, fleetId); if (!fleet.ok) return fleet;
  const instances = services.collection.fleetInstances(fleet.value); if (!instances.ok) return instances;
  const records = services.directory.agents({ ...page, ownerId: fleet.value.ownerId, agentIds: instances.value.map(instance => instance.agentId),
    statuses: ['active', 'suspended', 'revoked'], search: '' });
  if (!records.ok) return records;
  const activity = readActivity(services, records.value.items.map(record => record.principal.id)); if (!activity.ok) return activity;
  const keys = new Map(instances.value.map(instance => [instance.agentId, instance.instanceKey]));
  const permissions = actor.kind === 'controller' ? success([]) : services.directory.permissions(actor.principalId);
  if (!permissions.ok) return permissions;
  return success({ ...records.value, items: records.value.items.map(record => ({ instanceKey: keys.get(record.principal.id)!,
    agent: { record, activity: activity.value.get(record.principal.id)!, deployment: { agentId: record.principal.id, fleetId, fleetKey: fleet.value.fleetKey,
      label: fleet.value.label, controllerName: fleet.value.controllerName, reportedAt: fleet.value.updatedAt, instanceKey: keys.get(record.principal.id)! },
      allowedActions: actor.kind === 'controller' ? [] : agentActions(actor, record, permissions.value) } })) });
}
