import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { wakePolicy } from '@ctlflow/crossfire-contracts/schema/response';
import { collectPages } from '@ctlflow/crossfire-operator-support/collections';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { withHuman, type Human, type Credentials } from './auth.js';
import { wakeSelection } from '@ctlflow/crossfire-contracts/schema/request';

const instancePolicy = check.refine(check.object({ instanceKey: check.name, name: check.name, mode: check.wakeMode,
  senders: check.list(wakeSelection, 2000) }), entry => new Set(entry.senders.map(sender => sender.principalId)).size === entry.senders.length
    && (entry.mode !== 'everyone' || entry.senders.length === 0), 'Select unique identities; everyone requires no individual selections');
export const fleetWakePlan = check.refine(check.object({ fleetId: check.identifier, fleetKey: check.name,
  ownerBackendUserId: check.backendUserId, controllerName: check.text(100), instances: check.list(instancePolicy, 100, 1) }), plan =>
  new Set(plan.instances.map(entry => entry.instanceKey)).size === plan.instances.length
    && new Set(plan.instances.map(entry => entry.name)).size === plan.instances.length, 'Fleet instance keys and names must be unique');
type Plan = check.Parsed<typeof fleetWakePlan>;
type Policy = check.Parsed<typeof wakePolicy>;
type PolicyChange = { instanceKey: string; name: string; agentId: string; before: Policy; after: Policy; desired: Plan['instances'][number]; changeRequired: boolean };
export type FleetWakeReport = { fleetId: string; fleetKey: string; ownerBackendUserId: string; controllerName: string;
  executed: boolean; changed: number; instances: PolicyChange[] };

function sameIds(first: string[], second: string[]): boolean {
  return JSON.stringify([...first].sort()) === JSON.stringify([...second].sort());
}
function matches(policy: Policy, desired: Plan['instances'][number]): boolean {
  return policy.mode === desired.mode && sameIds(policy.senders.map(sender => sender.identity.principalId + ':' + sender.includeAgents),
    desired.senders.map(sender => sender.principalId + ':' + sender.includeAgents));
}
async function readRoster(human: Human, plan: Plan) {
  const current = await human.client.call(operations.fleet, { fleetId: plan.fleetId }, {});
  if (!current.ok) return current;
  const fleet = current.value.data;
  if (fleet.fleetId !== plan.fleetId || fleet.fleetKey !== plan.fleetKey || fleet.owner.backendUserId !== plan.ownerBackendUserId
    || fleet.controller.name !== plan.controllerName) return failure('conflict', 'Fleet differs from the exact supplied identity/owner/controller');
  const instances = await collectPages(query => human.client.call(operations.fleetAgents, { fleetId: plan.fleetId }, {}, query), entry => entry.agent.agentId);
  if (!instances.ok) return instances;
  if (instances.value.length !== plan.instances.length || instances.value.some(entry => !plan.instances.some(expected =>
    expected.instanceKey === entry.instanceKey && expected.name === entry.agent.name))) return failure('conflict', 'Fleet differs from the exact supplied roster');
  if (instances.value.some(entry => entry.agent.owner.backendUserId !== plan.ownerBackendUserId || entry.agent.status !== 'active'
    || entry.agent.owner.status !== 'active' || !entry.agent.allowedActions.includes('configure')
    || entry.agent.deployment?.fleetId !== plan.fleetId || entry.agent.deployment.instanceKey !== entry.instanceKey)) return failure('forbidden', 'Every planned agent must be active, owned by the expected owner, bound to this fleet and configurable');
  return success({ fleet, instances: instances.value });
}
async function prepare(human: Human, plan: Plan): Promise<Result<PolicyChange[]>> {
  const roster = await readRoster(human, plan); if (!roster.ok) return roster;
  const selectedIds = new Set(plan.instances.flatMap(entry => entry.senders.map(sender => sender.principalId)));
  if (selectedIds.size) {
    const available = await collectPages(query => human.client.call(operations.principals, {}, {}, query), entry => entry.principalId);
    if (!available.ok) return available;
    if ([...selectedIds].some(id => !available.value.some(entry => entry.principalId === id))) return failure('invalid', 'Selected senders must be active registered identities');
    if (plan.instances.some(entry => entry.senders.some(sender => sender.includeAgents
      && !available.value.some(identity => identity.principalId === sender.principalId && identity.kind === 'human')))) return failure('invalid', 'Only people can include their agents');
  }
  const changes: PolicyChange[] = [];
  for (const desired of plan.instances) {
    const instance = roster.value.instances.find(entry => entry.instanceKey === desired.instanceKey)!;
    const agentId = instance.agent.agentId;
    if (desired.senders.some(sender => sender.principalId === agentId)) return failure('invalid', 'An agent cannot select itself as a wake sender');
    const policy = await human.client.call(operations.wakePolicy, { agentId }, {}); if (!policy.ok) return policy;
    if (policy.value.data.agentId !== agentId || new Set(policy.value.data.senders.map(sender => sender.identity.principalId)).size !== policy.value.data.senders.length) return failure('native', 'Wake policy returned inconsistent identities');
    changes.push({ instanceKey: desired.instanceKey, name: desired.name, agentId, before: policy.value.data, after: policy.value.data,
      desired, changeRequired: !matches(policy.value.data, desired) });
  }
  return success(changes);
}

export async function reviewFleetWake(origin: string, account: Credentials, input: Plan, execute: boolean, signal: AbortSignal): Promise<Result<FleetWakeReport>> {
  const checked = fleetWakePlan(input); if (!checked.ok) return checked;
  const plan = checked.value;
  return withHuman(origin, account, signal, async human => {
    if (human.viewer.member.backendUserId !== plan.ownerBackendUserId && human.viewer.member.roleCode !== 'administrator') return failure('forbidden', 'Only the owner or administrator may configure this fleet');
    const initial = await readRoster(human, plan); if (!initial.ok) return initial;
    const prepared = await prepare(human, plan); if (!prepared.ok) return prepared;
    const completed: string[] = [];
    let attempted: string | undefined;
    const partial = (error: { code: Parameters<typeof failure>[0]; message: string }) => failure<FleetWakeReport>(error.code,
      error.message + '; verified writes: ' + (completed.join(', ') || 'none') + '; last attempted: ' + (attempted ?? 'none')
      + '. Writes are per-agent, not fleet-atomic; an attempted write may have succeeded. Rerun review before continuing.');
    if (execute) for (const change of prepared.value) {
      if (!change.changeRequired) continue;
      attempted = change.instanceKey;
      const changed = await human.client.call(operations.changeWakePolicy, { agentId: change.agentId }, {
        expectedRevision: change.before.revision, mode: change.desired.mode, senders: change.desired.senders,
      });
      if (!changed.ok) return partial(changed.error);
      const policy = changed.value.data;
      if (policy.agentId !== change.agentId || policy.revision !== change.before.revision + 1 || !matches(policy, change.desired)) return partial({ code: 'native', message: 'Updated wake policy differs from the requested change' });
      change.after = policy; completed.push(change.instanceKey);
    }
    const final = await readRoster(human, plan); if (!final.ok) return partial(final.error);
    if (final.value.fleet.revision !== initial.value.fleet.revision || final.value.instances.some(entry =>
      !prepared.value.some(change => change.instanceKey === entry.instanceKey && change.agentId === entry.agent.agentId))) return partial({ code: 'conflict', message: 'Fleet changed during configuration' });
    for (const change of prepared.value) {
      const current = await human.client.call(operations.wakePolicy, { agentId: change.agentId }, {}); if (!current.ok) return partial(current.error);
      if (current.value.data.agentId !== change.agentId || current.value.data.revision !== change.after.revision
        || !matches(current.value.data, { ...change.desired, mode: change.after.mode,
          senders: change.after.senders.map(sender => ({ principalId: sender.identity.principalId, includeAgents: sender.includeAgents })) })) return partial({ code: 'conflict', message: 'Wake policy changed during verification' });
    }
    return success({ fleetId: plan.fleetId, fleetKey: plan.fleetKey, ownerBackendUserId: plan.ownerBackendUserId,
      controllerName: plan.controllerName, executed: execute, changed: completed.length, instances: prepared.value });
  });
}
