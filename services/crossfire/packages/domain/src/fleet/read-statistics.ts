import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import { authorizeFleet } from './authority.js';

export function readFleetStatistics(services: Pick<Services, 'statistics' | 'repositories' | 'directory' | 'collection' | 'discovery' | 'clock'>,
  actor: Actor, fleetId: string, query: { hours: number; page: number; pageSize: number }) {
  if (![1, 24, 168, 720].includes(query.hours) || !Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) return failure('invalid', 'Invalid statistics window or pagination');
  const fleet = services.repositories.fleet.findById(fleetId);
  if (!fleet.ok) return fleet;
  if (!fleet.value) return failure('missing', 'Fleet not found');
  const authority = authorizeFleet(services, actor, fleet.value); if (!authority.ok) return authority;
  const instances = services.collection.fleetInstances(fleet.value); if (!instances.ok) return instances;
  const agentIds = instances.value.map(instance => instance.agentId), capturedAt = services.clock.now(), since = capturedAt - query.hours * 3_600_000;
  const records = services.discovery.selected(agentIds); if (!records.ok) return records;
  const names = new Map(records.value.map(record => [record.principalId, record]));
  const measured = services.statistics.read(agentIds, since, query.page, query.pageSize); if (!measured.ok) return measured;
  const senders = services.discovery.identities([...new Set(measured.value.flows.map(flow => flow.senderMatrixId))]); if (!senders.ok) return senders;
  const senderNames = new Map(senders.value.map(sender => [sender.matrixUserId, sender.displayName]));
  const { totalFlows, ...value } = measured.value;
  return success({ ...value, capturedAt, since, retentionDays: 30,
    agents: value.agents.map(agent => ({ ...agent, displayName: names.get(agent.agentId)!.displayName, matrixUserId: names.get(agent.agentId)!.matrixUserId })),
    flows: value.flows.map(({ roomId, senderMatrixId, messageType, agentId, ...totals }) => ({ agentId, roomId, senderMatrixId, messageType, totals, senderName: senderNames.get(senderMatrixId) ?? null })),
    meta: { page: query.page, pageSize: query.pageSize, totalItems: totalFlows, totalPages: Math.max(1, Math.ceil(totalFlows / query.pageSize)) }, spend: null });
}
