import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { Page, PageRequest } from '../port/directory.js';
import type { PrincipalSummary } from '../port/discovery.js';
import type { WakeSchedule } from '../port/schedule.js';

export type WakeRule = {
  id: string; ownerId: string; configuredById: string; name: string; message: string;
  schedule: WakeSchedule; enabled: boolean; revision: number; createdAt: number; updatedAt: number;
};
export type WakeRuleAgent = { ruleId: string; agentId: string; nextDueAt: number; lastDeliveredAt: number | null };
export type WakeDelivery = {
  id: string; ruleId: string; agentId: string; ruleRevision: number; runId: string; sessionId: string;
  scheduledAt: number; createdAt: number; status: 'pending' | 'delivered' | 'cancelled'; deliveredAt: number | null;
};
export type WakeRuleInput = { name: string; message: string; schedule: WakeSchedule; enabled: boolean; agentIds: string[] };
export type WakeRuleSummary = WakeRule & { owner: PrincipalSummary; agentCount: number; nextDueAt: number | null; lastDeliveredAt: number | null };
export type WakeRuleDetails = WakeRuleSummary & { agents: (PrincipalSummary & WakeRuleAgent)[] };
export type ScheduledWake = {
  deliveryId: string; ruleId: string; ruleRevision: number; name: string; message: string;
  scheduledAt: number; sessionId: string; ownerMatrixId: string; authorizerMatrixId: string;
};
export type WakeRuleRepository = {
  find(id: string): Result<WakeRule | null>;
  insert(rule: WakeRule): Result<void>;
  update(rule: WakeRule): Result<void>;
  remove(id: string): Result<void>;
  page(input: PageRequest & { ownerId?: string; search: string }): Result<Page<WakeRule>>;
};
export type WakeRuleAgentRepository = {
  find(ruleId: string, agentId: string): Result<WakeRuleAgent | null>;
  forRules(ruleIds: string[]): Result<WakeRuleAgent[]>;
  insert(assignment: WakeRuleAgent): Result<void>;
  update(assignment: WakeRuleAgent): Result<void>;
  remove(ruleId: string, agentId: string): Result<void>;
  due(agentId: string, now: number): Result<{ rule: WakeRule; assignment: WakeRuleAgent }[]>;
  nextDueAt(agentId: string): Result<number | null>;
};
export type WakeDeliveryRepository = {
  find(id: string): Result<WakeDelivery | null>;
  pending(agentId: string): Result<WakeDelivery | null>;
  insert(delivery: WakeDelivery): Result<void>;
  update(delivery: WakeDelivery): Result<void>;
  cancelPending(ruleId: string): Result<void>;
};
