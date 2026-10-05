import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { listWakeRules, readWakeRule } from '@ctlflow/crossfire-domain/wake-up/read';
import { createWakeRule, changeWakeRule, deleteWakeRule } from '@ctlflow/crossfire-domain/wake-up/manage';
import { wakeMetadata, claimWake, validateWake, acknowledgeWake } from '@ctlflow/crossfire-domain/wake-up/delivery';
import type { WakeRuleSummary, WakeRuleDetails } from '@ctlflow/crossfire-domain/wake-up/types';
import { bind, actor, paged, reply } from '../bind.js';

function summary(rule: WakeRuleSummary) {
  return { ruleId: rule.id, owner: rule.owner, configuredById: rule.configuredById, name: rule.name, message: rule.message,
    schedule: rule.schedule, enabled: rule.enabled, revision: rule.revision, createdAt: rule.createdAt, updatedAt: rule.updatedAt,
    agentCount: rule.agentCount, nextDueAt: rule.nextDueAt, lastDeliveredAt: rule.lastDeliveredAt };
}
function details(rule: WakeRuleDetails) { return { ...summary(rule), agents: rule.agents }; }
export function wakeUpRoutes() {
  return [
    bind(operations.wakeRules, (context, _params, query) => paged(listWakeRules(context.services, actor(context), query), summary)),
    bind(operations.createWakeRule, (context, _params, _query, input) => reply(createWakeRule(context.services, actor(context), input.ruleId, input, context.requestId), details)),
    bind(operations.wakeRule, (context, params) => reply(readWakeRule(context.services, actor(context), params.ruleId), details)),
    bind(operations.changeWakeRule, (context, params, _query, input) => reply(changeWakeRule(context.services, actor(context), params.ruleId, input, context.requestId), details)),
    bind(operations.deleteWakeRule, (context, params, _query, input) => reply(deleteWakeRule(context.services, actor(context), params.ruleId, input.expectedRevision, context.requestId))),
    bind(operations.wakeMetadata, (context, params, query) => reply(wakeMetadata(context.services, actor(context), params.agentId, query))),
    bind(operations.claimWake, (context, params, _query, input) => reply(claimWake(context.services, actor(context), params.agentId, input))),
    bind(operations.validateWake, (context, params, query) => reply(validateWake(context.services, actor(context), params.agentId, params.deliveryId, query))),
    bind(operations.acknowledgeWake, (context, params, _query, input) => reply(acknowledgeWake(context.services, actor(context), params.agentId, params.deliveryId, input))),
  ];
}
