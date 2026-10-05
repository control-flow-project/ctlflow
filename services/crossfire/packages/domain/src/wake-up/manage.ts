import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { authorize, authorizeAgent } from '../authorization/authorize.js';
import { recordEvent } from '../audit/record-event.js';
import type { Actor, Services } from '../port/services.js';
import type { WakeRuleInput, WakeRule, WakeRuleDetails } from './types.js';
import { authorizedRule } from './authority.js';
import { readWakeRule } from './read.js';
import type { WakeSchedule } from '../port/schedule.js';

function sameSchedule(left: WakeSchedule, right: WakeSchedule): boolean {
  return left.kind === 'interval' && right.kind === 'interval' ? left.seconds === right.seconds
    : left.kind === 'cron' && right.kind === 'cron' && left.expression === right.expression && left.timeZone === right.timeZone;
}

function validate(services: Services, actor: Actor, input: WakeRuleInput): Result<number> {
  if (!input.name.trim() || input.name.length > 100 || /[\u0000-\u001f\u007f]/u.test(input.name)
    || !input.message.trim() || new TextEncoder().encode(input.message).length > 16_384
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.message)) return failure('invalid', 'Provide a name and a plain-text wake-up message of at most 16 KiB');
  if (input.agentIds.length > 1000 || new Set(input.agentIds).size !== input.agentIds.length) return failure('invalid', 'Select at most 1000 distinct agents');
  const next = services.schedule.next(input.schedule, services.clock.now()); if (!next.ok) return next;
  for (const agentId of input.agentIds) {
    const allowed = authorizeAgent(services, actor, agentId, 'configure'); if (!allowed.ok) return allowed;
    if (allowed.value.principal.status !== 'active' || allowed.value.owner.status !== 'active') return failure('conflict', 'Only active agents with active owners can be attached');
  }
  return next;
}
function setAgents(services: Services, ruleId: string, agentIds: string[], nextDueAt: number): Result<void> {
  const previous = services.repositories.wakeRuleAgent.forRules([ruleId]); if (!previous.ok) return previous;
  const selected = new Set(agentIds), byAgent = new Map(previous.value.map(assignment => [assignment.agentId, assignment]));
  for (const assignment of previous.value) if (!selected.has(assignment.agentId)) {
    const removed = services.repositories.wakeRuleAgent.remove(ruleId, assignment.agentId); if (!removed.ok) return removed;
  }
  for (const agentId of agentIds) {
    const before = byAgent.get(agentId);
    const next = { ruleId, agentId, nextDueAt, lastDeliveredAt: before?.lastDeliveredAt ?? null };
    const saved = before ? services.repositories.wakeRuleAgent.update(next) : services.repositories.wakeRuleAgent.insert(next);
    if (!saved.ok) return saved;
  }
  return success(undefined);
}
export function createWakeRule(services: Services, actor: Actor, ruleId: string, input: WakeRuleInput, requestId: string): Result<WakeRuleDetails> {
  return services.unitOfWork.run(() => {
    if (actor.kind !== 'human') return failure('forbidden', 'Only members create Wake-ups');
    const allowed = authorize(services, actor, 'wake-rule.manage.owned'); if (!allowed.ok) return allowed;
    const existing = services.repositories.wakeRule.find(ruleId); if (!existing.ok) return existing;
    if (existing.value) {
      const details = readWakeRule(services, actor, ruleId); if (!details.ok) return details;
      return existing.value.ownerId === actor.principalId && existing.value.revision === 0 && existing.value.name === input.name.trim()
        && existing.value.message === input.message && sameSchedule(existing.value.schedule, input.schedule)
        && existing.value.enabled === input.enabled && details.value.agents.map(agent => agent.agentId).sort().join() === [...input.agentIds].sort().join()
        ? details : failure('conflict', 'Wake-up ID belongs to a different request');
    }
    const next = validate(services, actor, input); if (!next.ok) return next;
    const now = services.clock.now();
    const rule: WakeRule = { id: ruleId, ownerId: actor.principalId, configuredById: actor.principalId, name: input.name.trim(), message: input.message,
      schedule: input.schedule, enabled: input.enabled, revision: 0, createdAt: now, updatedAt: now };
    const saved = services.repositories.wakeRule.insert(rule); if (!saved.ok) return saved;
    const attached = setAgents(services, ruleId, input.agentIds, next.value); if (!attached.ok) return attached;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'wake-rule', targetId: ruleId, ownerId: rule.ownerId, action: 'wake-rule.create',
      permissionCode: 'wake-rule.manage.owned', message: 'Created Wake-up “' + rule.name + '”.' });
    return audit.ok ? readWakeRule(services, actor, ruleId) : audit;
  });
}
export function changeWakeRule(services: Services, actor: Actor, ruleId: string, input: WakeRuleInput & { expectedRevision: number }, requestId: string): Result<WakeRuleDetails> {
  return services.unitOfWork.run(() => {
    const current = authorizedRule(services, actor, ruleId, true); if (!current.ok) return current;
    if (current.value.revision !== input.expectedRevision) return failure('stale_revision', 'Refresh the Wake-up before saving changes');
    const next = validate(services, actor, input); if (!next.ok) return next;
    const rule = { ...current.value, name: input.name.trim(), message: input.message, schedule: input.schedule, enabled: input.enabled,
      configuredById: actor.principalId, revision: current.value.revision + 1, updatedAt: services.clock.now() };
    const saved = services.repositories.wakeRule.update(rule); if (!saved.ok) return saved;
    const cancelled = services.repositories.wakeDelivery.cancelPending(ruleId); if (!cancelled.ok) return cancelled;
    const attached = setAgents(services, ruleId, input.agentIds, next.value); if (!attached.ok) return attached;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'wake-rule', targetId: ruleId, ownerId: rule.ownerId, action: 'wake-rule.update',
      permissionCode: rule.ownerId === actor.principalId ? 'wake-rule.manage.owned' : 'wake-rule.manage.any', message: 'Updated Wake-up “' + rule.name + '”.' });
    return audit.ok ? readWakeRule(services, actor, ruleId) : audit;
  });
}
export function deleteWakeRule(services: Services, actor: Actor, ruleId: string, expectedRevision: number, requestId: string) {
  return services.unitOfWork.run(() => {
    const rule = authorizedRule(services, actor, ruleId, true); if (!rule.ok) return rule;
    if (rule.value.revision !== expectedRevision) return failure('stale_revision', 'Refresh the Wake-up before deleting it');
    const deleted = services.repositories.wakeRule.remove(ruleId); if (!deleted.ok) return deleted;
    const audit = recordEvent(services, actor, requestId, { targetKind: 'wake-rule', targetId: ruleId, ownerId: rule.value.ownerId, action: 'wake-rule.delete',
      permissionCode: rule.value.ownerId === actor.principalId ? 'wake-rule.manage.owned' : 'wake-rule.manage.any', message: 'Deleted Wake-up “' + rule.value.name + '”.' });
    return audit.ok ? success({ deleted: true }) : audit;
  });
}
