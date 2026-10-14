import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Actor, Services } from '../port/services.js';
import { HEARTBEAT_EXPIRY_MS } from '../listener/report.js';
import { liveReceiver, scheduledReceiver, ruleCanWake, wakeReceiverAuthority } from './authority.js';
import type { ScheduledWake, WakeDelivery, WakeRule } from './types.js';

export type WakeAttachment = { runId: string; sessionId: string };
function attachment(input: WakeAttachment): Result<void> {
  return input.sessionId.length >= 1 && input.sessionId.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(input.sessionId)
    ? success(undefined) : failure('invalid', 'Invalid native session identity');
}
function command(services: Services, rule: WakeRule, delivery: WakeDelivery): Result<ScheduledWake> {
  const owner = services.repositories.principal.find({ id: rule.ownerId }); if (!owner.ok) return owner;
  const authorizer = services.repositories.principal.find({ id: rule.configuredById }); if (!authorizer.ok) return authorizer;
  if (!owner.value || !authorizer.value) return failure('unavailable', 'Wake-up authority is missing');
  return success({ deliveryId: delivery.id, ruleId: rule.id, ruleRevision: delivery.ruleRevision, name: rule.name, message: rule.message,
    scheduledAt: delivery.scheduledAt, sessionId: delivery.sessionId, ownerMatrixId: owner.value.matrixUserId, authorizerMatrixId: authorizer.value.matrixUserId });
}
export function wakeMetadata(services: Services, actor: Actor, agentId: string, input: WakeAttachment) {
  const parsed = attachment(input); if (!parsed.ok) return parsed;
  const live = liveReceiver(services, actor, agentId, input.runId); if (!live.ok) return live;
  const next = services.repositories.wakeRuleAgent.nextDueAt(agentId); if (!next.ok) return next;
  const pending = services.repositories.wakeDelivery.pending(agentId); if (!pending.ok) return pending;
  return success({ now: services.clock.now(), nextDueAt: live.value && pending.value?.sessionId === input.sessionId ? services.clock.now() : next.value });
}
export function claimWake(services: Services, actor: Actor, agentId: string, input: WakeAttachment): Result<ScheduledWake | null> {
  return services.unitOfWork.run(() => {
    const parsed = attachment(input); if (!parsed.ok) return parsed;
    const live = liveReceiver(services, actor, agentId, input.runId); if (!live.ok) return live;
    if (!live.value) return success(null);
    const previous = services.repositories.wakeDelivery.pending(agentId); if (!previous.ok) return previous;
    if (previous.value) {
      const delivery = previous.value;
      if (delivery.sessionId !== input.sessionId) return success(null);
      if (delivery.runId !== input.runId) {
        const run = services.repositories.listenerRun.find({ id: delivery.runId }); if (!run.ok) return run;
        if (run.value?.stoppedAt === null && run.value.lastSeenAt >= services.clock.now() - HEARTBEAT_EXPIRY_MS) return success(null);
      }
      const rule = services.repositories.wakeRule.find(delivery.ruleId); if (!rule.ok) return rule;
      if (!rule.value) return failure('unavailable', 'Wake-up rule is missing');
      const allowed = ruleCanWake(services, rule.value, agentId); if (!allowed.ok) return allowed;
      if (!allowed.value || rule.value.revision !== delivery.ruleRevision) {
        const saved = services.repositories.wakeDelivery.update({ ...delivery, status: 'cancelled' });
        return saved.ok ? success(null) : saved;
      }
      const saved = services.repositories.wakeDelivery.update({ ...delivery, runId: input.runId }); if (!saved.ok) return saved;
      return command(services, rule.value, { ...delivery, runId: input.runId });
    }
    const due = services.repositories.wakeRuleAgent.due(agentId, services.clock.now()); if (!due.ok) return due;
    for (const item of due.value) {
      const schedule = item.rule.schedule;
      const after = schedule.kind === 'interval'
        ? item.assignment.nextDueAt + Math.floor((services.clock.now() - item.assignment.nextDueAt) / (schedule.seconds * 1000)) * schedule.seconds * 1000
        : services.clock.now();
      const next = services.schedule.next(schedule, after); if (!next.ok) return next;
      const moved = services.repositories.wakeRuleAgent.update({ ...item.assignment, nextDueAt: next.value }); if (!moved.ok) return moved;
      const allowed = ruleCanWake(services, item.rule, agentId); if (!allowed.ok) return allowed;
      if (!allowed.value) continue;
      const delivery: WakeDelivery = { id: services.identity.id(), ruleId: item.rule.id, agentId, ruleRevision: item.rule.revision,
        runId: input.runId, sessionId: input.sessionId, scheduledAt: item.assignment.nextDueAt, createdAt: services.clock.now(), status: 'pending', deliveredAt: null };
      const saved = services.repositories.wakeDelivery.insert(delivery); if (!saved.ok) return saved;
      return command(services, item.rule, delivery);
    }
    return success(null);
  });
}
export function validateWake(services: Services, actor: Actor, agentId: string, deliveryId: string, input: WakeAttachment) {
  const live = liveReceiver(services, actor, agentId, input.runId); if (!live.ok) return live;
  if (!live.value) return success({ eligible: false });
  const delivery = services.repositories.wakeDelivery.find(deliveryId); if (!delivery.ok) return delivery;
  if (!delivery.value || delivery.value.agentId !== agentId) return success({ eligible: false });
  if (delivery.value.runId !== input.runId || delivery.value.sessionId !== input.sessionId || delivery.value.status !== 'pending') return success({ eligible: false });
  const rule = services.repositories.wakeRule.find(delivery.value.ruleId); if (!rule.ok) return rule;
  if (!rule.value || rule.value.revision !== delivery.value.ruleRevision) return success({ eligible: false });
  const allowed = ruleCanWake(services, rule.value, agentId);
  return allowed.ok ? success({ eligible: allowed.value }) : allowed;
}
export function acknowledgeWake(services: Services, actor: Actor, agentId: string, deliveryId: string, input: WakeAttachment) {
  return services.unitOfWork.run(() => {
    const parsed = attachment(input); if (!parsed.ok) return parsed;
    const authority = wakeReceiverAuthority(services, actor, agentId); if (!authority.ok) return authority;
    const delivery = services.repositories.wakeDelivery.find(deliveryId); if (!delivery.ok) return delivery;
    if (!delivery.value) return success({ recorded: false });
    const receiver = scheduledReceiver(services, actor, agentId, input.runId); if (!receiver.ok) return receiver;
    if (delivery.value.agentId !== agentId || delivery.value.runId !== input.runId || delivery.value.sessionId !== input.sessionId) {
      return failure('missing', 'Wake-up receipt not found');
    }
    if (delivery.value.status === 'delivered') return success({ recorded: true });
    const now = services.clock.now();
    const saved = services.repositories.wakeDelivery.update({ ...delivery.value, status: 'delivered', deliveredAt: now }); if (!saved.ok) return saved;
    const assignment = services.repositories.wakeRuleAgent.find(delivery.value.ruleId, agentId); if (!assignment.ok) return assignment;
    if (!assignment.value) return failure('unavailable', 'Wake-up assignment is missing');
    const updated = services.repositories.wakeRuleAgent.update({ ...assignment.value, lastDeliveredAt: Math.max(now, assignment.value.lastDeliveredAt ?? 0) });
    return updated.ok ? success({ recorded: true }) : updated;
  });
}
