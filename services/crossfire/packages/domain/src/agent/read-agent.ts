import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Services, Actor } from '../port/services.js';
import type { DirectoryFilter, AgentRecord, Page, DeploymentSummary } from '../port/directory.js';
import { activeActor, authorizeAgent } from '../authorization/authorize.js';
import { readActivity, type AgentActivity } from '../listener/activity.js';
import { HEARTBEAT_EXPIRY_MS } from '../listener/report.js';
import type { NativeRuntimeSummary } from '../runtime/values.js';
import { retirementEligible } from '../fleet/native-stop.js';
type Dependencies = Pick<Services, 'repositories' | 'directory' | 'listenerRead' | 'clock' | 'runtime'>;
export type AgentDetails = { record: AgentRecord; activity: AgentActivity; nativeRuntime: NativeRuntimeSummary | null; deployment: DeploymentSummary; canRetire: boolean; allowedActions: string[] };
export type AgentFilter = DirectoryFilter & { listener: 'all' | 'online' | 'offline' | 'disconnecting' };
export function agentActions(actor: Actor, record: AgentRecord, permissions: string[], canRetire: boolean): string[] {
  const actions = ['configure', 'room-grant.manage'].filter(action =>
    permissions.includes('agent.' + action + '.any') || actor.principalId === record.agent.ownerId && permissions.includes('agent.' + action + '.owned'));
  return canRetire && actions.includes('configure') ? [...actions, 'retire'] : actions;
}
export function readAgent(services: Dependencies, actor: Actor, agentId: string): Result<AgentDetails> {
  const record = authorizeAgent(services, actor, agentId, 'read');
  if (!record.ok) return record;
  const activity = readActivity(services, [agentId]), permissions = services.directory.permissions(actor.principalId);
  if (!activity.ok) return activity; if (!permissions.ok) return permissions;
  const deployment = services.directory.deployments([agentId]); if (!deployment.ok) return deployment;
  if (deployment.value.length !== 1) return failure('missing', 'Current fleet-managed agent not found');
  const native = services.runtime.summaries([agentId]); if (!native.ok) return native;
  const eligible = retirementEligible(services, deployment.value[0]!.fleetId, agentId); if (!eligible.ok) return eligible;
  return success({ record: record.value, activity: activity.value.get(agentId)!, nativeRuntime: native.value.get(agentId) ?? null,
    deployment: deployment.value[0]!, canRetire: eligible.value, allowedActions: agentActions(actor, record.value, permissions.value, eligible.value) });
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
    const reporting = services.listenerRead.reportingAgentIds(since, true, services.clock.now()), online = services.listenerRead.reportingAgentIds(since, false, services.clock.now());
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
  if (records.value.items.some(record => !byAgent.has(record.principal.id))) return failure('unavailable', 'Current agent fleet binding is missing');
  const native = services.runtime.summaries(records.value.items.map(record => record.principal.id)); if (!native.ok) return native;
  const items: AgentDetails[] = [];
  for (const record of records.value.items) {
    const deployment = byAgent.get(record.principal.id)!;
    const eligible = retirementEligible(services, deployment.fleetId, record.principal.id); if (!eligible.ok) return eligible;
    items.push({ record, activity: activity.value.get(record.principal.id)!, deployment, nativeRuntime: native.value.get(record.principal.id) ?? null,
      canRetire: eligible.value, allowedActions: agentActions(actor, record, permissions.value, eligible.value) });
  }
  return success({ ...records.value, items });
}
