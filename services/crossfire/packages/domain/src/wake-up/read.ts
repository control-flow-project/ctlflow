import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { ownerScope } from '../authorization/read-scope.js';
import type { Actor, Services } from '../port/services.js';
import type { Page, PageRequest } from '../port/directory.js';
import type { WakeRule, WakeRuleAgent, WakeRuleSummary, WakeRuleDetails } from './types.js';
import { authorizedRule } from './authority.js';

export function summarizeRules(services: Services, rules: WakeRule[]): Result<WakeRuleSummary[]> {
  const owners = services.discovery.selected([...new Set(rules.map(rule => rule.ownerId))]); if (!owners.ok) return owners;
  const assignments = services.repositories.wakeRuleAgent.forRules(rules.map(rule => rule.id)); if (!assignments.ok) return assignments;
  const byOwner = new Map(owners.value.map(owner => [owner.principalId, owner]));
  const byRule = new Map<string, WakeRuleAgent[]>();
  for (const assignment of assignments.value) {
    const grouped = byRule.get(assignment.ruleId) ?? []; grouped.push(assignment); byRule.set(assignment.ruleId, grouped);
  }
  const results: WakeRuleSummary[] = [];
  for (const rule of rules) {
    const owner = byOwner.get(rule.ownerId);
    if (!owner) return failure('unavailable', 'Wake-up owner is missing');
    const attached = byRule.get(rule.id) ?? [];
    results.push({ ...rule, owner, agentCount: attached.length,
      nextDueAt: rule.enabled && attached.length ? Math.min(...attached.map(assignment => assignment.nextDueAt)) : null,
      lastDeliveredAt: attached.some(assignment => assignment.lastDeliveredAt !== null)
        ? Math.max(...attached.flatMap(assignment => assignment.lastDeliveredAt === null ? [] : [assignment.lastDeliveredAt])) : null });
  }
  return success(results);
}
export function listWakeRules(services: Services, actor: Actor, input: PageRequest & { search: string; ownerId?: string }): Result<Page<WakeRuleSummary>> {
  if (actor.kind !== 'human') return failure('forbidden', 'Only members can list Wake-ups');
  const scope = ownerScope(services, actor, 'wake-rule.read', input.ownerId); if (!scope.ok) return scope;
  const rules = services.repositories.wakeRule.page({ ...input, ...scope.value }); if (!rules.ok) return rules;
  const summaries = summarizeRules(services, rules.value.items);
  return summaries.ok ? success({ ...rules.value, items: summaries.value }) : summaries;
}
export function readWakeRule(services: Services, actor: Actor, ruleId: string): Result<WakeRuleDetails> {
  const rule = authorizedRule(services, actor, ruleId); if (!rule.ok) return rule;
  const summaries = summarizeRules(services, [rule.value]); if (!summaries.ok) return summaries;
  const assignments = services.repositories.wakeRuleAgent.forRules([ruleId]); if (!assignments.ok) return assignments;
  const agents = services.discovery.selected(assignments.value.map(assignment => assignment.agentId)); if (!agents.ok) return agents;
  const byAgent = new Map(agents.value.map(agent => [agent.principalId, agent]));
  const details: WakeRuleDetails['agents'] = [];
  for (const assignment of assignments.value) {
    const agent = byAgent.get(assignment.agentId);
    if (!agent) return failure('unavailable', 'Wake-up agent is missing');
    details.push({ ...agent, ...assignment });
  }
  return success({ ...summaries.value[0]!, agents: details });
}
