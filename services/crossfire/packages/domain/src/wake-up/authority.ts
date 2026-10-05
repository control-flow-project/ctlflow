import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { activeActor, authorize } from '../authorization/authorize.js';
import type { Actor, Services } from '../port/services.js';
import type { WakeRule } from './types.js';
import { HEARTBEAT_EXPIRY_MS } from '../listener/report.js';
import { connectionView } from '../fleet/control.js';

export function authorizedRule(services: Services, actor: Actor, ruleId: string, write = false) {
  if (actor.kind !== 'human') return failure('forbidden', 'Only members manage Wake-ups');
  const active = activeActor(services, actor); if (!active.ok) return active;
  const found = services.repositories.wakeRule.find(ruleId); if (!found.ok) return found;
  if (!found.value) return failure('missing', 'Wake-up not found');
  const permissions = services.directory.permissions(actor.principalId); if (!permissions.ok) return permissions;
  const action = write ? 'manage' : 'read';
  return permissions.value.includes('wake-rule.' + action + '.any')
    || found.value.ownerId === actor.principalId && permissions.value.includes('wake-rule.' + action + '.owned')
    ? success(found.value) : failure('missing', 'Wake-up not found');
}
export function scheduledReceiver(services: Services, actor: Actor, agentId: string, runId: string) {
  const allowed = authorize(services, actor, 'wake-delivery.receive.self'); if (!allowed.ok) return allowed;
  if (actor.kind !== 'agent' || actor.principalId !== agentId) return failure('missing', 'Wake-up receiver not found');
  const run = services.repositories.listenerRun.find({ id: runId }); if (!run.ok) return run;
  if (!run.value || run.value.agentId !== agentId) return failure('missing', 'Listener run not found');
  return success(run.value);
}
export function liveReceiver(services: Services, actor: Actor, agentId: string, runId: string) {
  const run = scheduledReceiver(services, actor, agentId, runId); if (!run.ok) return run;
  if (run.value.stoppedAt !== null || run.value.disconnectRequestedAt !== null
    || run.value.lastSeenAt < services.clock.now() - HEARTBEAT_EXPIRY_MS) return success(false);
  if (!run.value.controllerBound) return success(true);
  const deployments = services.directory.deployments([agentId]); if (!deployments.ok) return deployments;
  if (!deployments.value.length) return success(false);
  for (const deployment of deployments.value) {
    const fleet = services.repositories.fleet.findById(deployment.fleetId); if (!fleet.ok) return fleet;
    const connection = services.repositories.fleetConnection.find(deployment.fleetId); if (!connection.ok) return connection;
    if (!fleet.value?.deliveryEnabled || connectionView(connection.value, services.clock.now()).status !== 'online') return success(false);
  }
  return success(true);
}
export function ruleCanWake(services: Services, rule: WakeRule, agentId: string) {
  if (!rule.enabled) return success(false);
  const owner = services.repositories.principal.find({ id: rule.ownerId }); if (!owner.ok) return owner;
  const authorizer = services.repositories.principal.find({ id: rule.configuredById }); if (!authorizer.ok) return authorizer;
  if (owner.value?.status !== 'active' || authorizer.value?.status !== 'active') return success(false);
  const agent = services.repositories.agent.find({ principalId: agentId }); if (!agent.ok) return agent;
  if (!agent.value) return success(false);
  const permissions = services.directory.permissions(rule.configuredById); if (!permissions.ok) return permissions;
  return success(permissions.value.includes('agent.configure.any')
    || agent.value.ownerId === rule.configuredById && permissions.value.includes('agent.configure.owned'));
}
