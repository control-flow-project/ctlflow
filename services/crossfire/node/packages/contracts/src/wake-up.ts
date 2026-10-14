import * as check from './schema/validation.js';
import { principal } from './schema/response.js';
import { listQuery } from './schema/request.js';
import { failure } from '@ctlflow/crossfire-kernel/result';

export type WakeSchedule = { kind: 'interval'; seconds: number } | { kind: 'cron'; expression: string; timeZone: string };
export const wakeSchedule: check.Parser<WakeSchedule> = input => {
  if (!input || typeof input !== 'object' || !('kind' in input)) return failure('invalid', 'Choose an interval or calendar schedule');
  if (input.kind === 'interval') return check.object({ kind: check.choice('interval'), seconds: check.integer(1, 31_536_000) })(input);
  if (input.kind === 'cron') return check.object({ kind: check.choice('cron'), expression: check.text(200), timeZone: check.text(100) })(input);
  return failure('invalid', 'Unknown schedule kind');
};
const name = check.refine(check.text(100), value => !!value.trim(), 'Provide a Wake-up name');
const message = check.refine(check.plainText(16_384), value => !!value.trim(), 'Provide a wake-up message');
const agentIds = check.refine(check.list(check.identifier, 1000), ids => new Set(ids).size === ids.length, 'Duplicate attached agents');
const fields = { name, message, schedule: wakeSchedule, enabled: check.boolean, agentIds };
export const wakeRuleCreation = check.object({ ruleId: check.identifier, ...fields });
export const wakeRuleChange = check.object({ expectedRevision: check.integer(), ...fields });
export const wakeRuleRemoval = check.object({ expectedRevision: check.integer() });
const summary = { ruleId: check.identifier, owner: principal, configuredById: check.identifier, name, message, schedule: wakeSchedule,
  enabled: check.boolean, revision: check.integer(), createdAt: check.integer(), updatedAt: check.integer(), agentCount: check.integer(0, 1000),
  nextDueAt: check.nullable(check.integer()), lastDeliveredAt: check.nullable(check.integer()) };
export const wakeRuleSummary = check.object(summary);
export const wakeRuleAgent = check.object({ principalId: check.identifier, matrixUserId: check.matrixUserId, kind: check.choice('agent'),
  displayName: check.text(255), ownerId: check.identifier, ownerMatrixId: check.matrixUserId,
  ruleId: check.identifier, agentId: check.identifier, nextDueAt: check.integer(), lastDeliveredAt: check.nullable(check.integer()) });
export const wakeRuleDetails = check.object({ ...summary, agents: check.list(wakeRuleAgent, 1000) });
export const wakeAttachment = check.object({ runId: check.identifier, sessionId: check.text(200) });
export function wakeAttachmentQuery(input: unknown) {
  const values = listQuery(['runId', 'sessionId'])(input); if (!values.ok) return values;
  return wakeAttachment({ runId: values.value.get('runId'), sessionId: values.value.get('sessionId') });
}
export const wakeMetadata = check.object({ now: check.integer(), nextDueAt: check.nullable(check.integer()) });
export const scheduledWake = check.object({ deliveryId: check.identifier, ruleId: check.identifier, ruleRevision: check.integer(), name, message,
  scheduledAt: check.integer(), sessionId: check.text(200), ownerMatrixId: check.matrixUserId, authorizerMatrixId: check.matrixUserId });
export type WakeRuleSummary = check.Parsed<typeof wakeRuleSummary>;
export type WakeRuleDetails = check.Parsed<typeof wakeRuleDetails>;
export type WakeAttachment = check.Parsed<typeof wakeAttachment>;
export type ScheduledWake = check.Parsed<typeof scheduledWake>;
