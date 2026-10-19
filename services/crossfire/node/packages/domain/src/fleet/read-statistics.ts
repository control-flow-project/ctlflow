import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorizeFleet } from './authority.js';
import { DAY_MS } from '@ctlflow/crossfire-kernel/logging';

export function readFleetStatistics(services: Pick<Services, 'statistics' | 'repositories' | 'directory' | 'collection' | 'discovery' | 'clock' | 'logging'>,
  actor: Actor, fleetId: string, query: { hours: number; page: number; pageSize: number }) {
  if (![1, 24, 168, 720].includes(query.hours) || !Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) return failure('invalid', 'Invalid statistics window or pagination');
  const fleet = services.repositories.fleet.findById(fleetId);
  if (!fleet.ok) return fleet;
  if (!fleet.value) return failure('missing', 'Fleet not found');
  const authority = authorizeFleet(services, actor, fleet.value); if (!authority.ok) return authority;
  const instances = services.collection.fleetInstances(fleet.value); if (!instances.ok) return instances;
  const agentIds = instances.value.map(instance => instance.agentId), capturedAt = services.clock.now(), since = Math.max(capturedAt - query.hours * 3_600_000, capturedAt - services.logging.days * DAY_MS);
  const records = services.discovery.selected(agentIds); if (!records.ok) return records;
  const names = new Map(records.value.map(record => [record.principalId, record]));
  const measured = services.statistics.read(agentIds, since, query.page, query.pageSize); if (!measured.ok) return measured;
  const senders = services.discovery.identities([...new Set(measured.value.flows.map(flow => flow.senderBackendUserId))]); if (!senders.ok) return senders;
  const senderNames = new Map(senders.value.map(sender => [sender.backendUserId, sender.displayName]));
  const { totalFlows, ...value } = measured.value;
  return success({ ...value, capturedAt, since, retentionDays: services.logging.days,
    agents: value.agents.map(agent => ({ ...agent, displayName: names.get(agent.agentId)!.displayName, backendUserId: names.get(agent.agentId)!.backendUserId })),
    flows: value.flows.map(({ roomId, senderBackendUserId, messageType, agentId, ...totals }) => ({ agentId, roomId, senderBackendUserId, messageType, totals, senderName: senderNames.get(senderBackendUserId) ?? null })),
    meta: { page: query.page, pageSize: query.pageSize, totalItems: totalFlows, totalPages: Math.max(1, Math.ceil(totalFlows / query.pageSize)) }, spend: null });
}
