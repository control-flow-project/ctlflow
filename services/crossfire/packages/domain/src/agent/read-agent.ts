import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { DirectoryFilter, AgentRecord, Page, DeploymentSummary } from '../port/directory.js';
import { activeActor, authorizeAgent } from '../authorization/authorize.js';
import { readActivity, type AgentActivity } from '../listener/activity.js';
import { HEARTBEAT_EXPIRY_MS } from '../listener/report.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'listenerRead' | 'clock'>;
export type AgentDetails = { record: AgentRecord; activity: AgentActivity; deployment: DeploymentSummary | null; allowedActions: string[] };
export type AgentFilter = DirectoryFilter & { listener: 'all' | 'online' | 'offline' | 'disconnecting' };
export function agentActions(actor: Actor, record: AgentRecord, permissions: string[]): string[] {
  return ['configure', 'room-grant.manage', 'listener.disconnect'].filter(action =>
    permissions.includes('agent.' + action + '.any') || actor.principalId === record.agent.ownerId && permissions.includes('agent.' + action + '.owned'));
}
export function readAgent(services: Dependencies, actor: Actor, agentId: string): Result<AgentDetails> {
  const record = authorizeAgent(services, actor, agentId, 'read');
  if (!record.ok) return record;
  const activity = readActivity(services, [agentId]), permissions = services.directory.permissions(actor.principalId);
  if (!activity.ok) return activity; if (!permissions.ok) return permissions;
  const deployment = services.directory.deployments([agentId]); if (!deployment.ok) return deployment;
  return success({ record: record.value, activity: activity.value.get(agentId)!, deployment: deployment.value[0] ?? null, allowedActions: agentActions(actor, record.value, permissions.value) });
}
export function listAgents(services: Dependencies, actor: Actor, filter: AgentFilter): Result<Page<AgentDetails>> {
  const current = activeActor(services, actor);
  if (!current.ok) return current;
  const permissions = services.directory.permissions(actor.principalId);
  if (!permissions.ok) return permissions;
  const all = permissions.value.includes('agent.read.any');
  if (!all && !permissions.value.includes('agent.read.owned')) return failure('forbidden', 'Agent listing is not permitted');
  if (!all && filter.ownerId !== undefined && filter.ownerId !== actor.principalId) return failure('forbidden', 'Only your agents are visible');
  const query: DirectoryFilter = { page: filter.page, pageSize: filter.pageSize, search: filter.search, statuses: filter.statuses,
    ...(all ? filter.ownerId === undefined ? {} : { ownerId: filter.ownerId } : { ownerId: actor.principalId }) };
  if (filter.listener !== 'all') {
    const since = services.clock.now() - HEARTBEAT_EXPIRY_MS;
    const reporting = services.listenerRead.reportingAgentIds(since, true), online = services.listenerRead.reportingAgentIds(since, false);
    if (!reporting.ok) return reporting; if (!online.ok) return online;
    query.activity = { mode: filter.listener === 'offline' ? 'exclude' : 'include',
      agentIds: filter.listener === 'online' ? online.value : filter.listener === 'offline' ? reporting.value : reporting.value.filter(id => !online.value.includes(id)) };
  }
  const records = services.directory.agents(query);
  if (!records.ok) return records;
  const activity = readActivity(services, records.value.items.map(record => record.principal.id));
  if (!activity.ok) return activity;
  const deployments = services.directory.deployments(records.value.items.map(record => record.principal.id)); if (!deployments.ok) return deployments;
  const byAgent = new Map(deployments.value.map(deployment => [deployment.agentId, deployment]));
  return success({ ...records.value, items: records.value.items.map(record => ({ record, activity: activity.value.get(record.principal.id)!,
    deployment: byAgent.get(record.principal.id) ?? null,
    allowedActions: agentActions(actor, record, permissions.value) })) });
}
