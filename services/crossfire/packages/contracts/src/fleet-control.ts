import * as check from './schema/validation.js';
import { listQuery } from './schema/request.js';
import { failure, success } from '@crossfire/kernel/result';
import type { Parsed } from './schema/validation.js';

export const fleetControl = check.object({ fleetId: check.identifier, revision: check.integer(), deliveryEnabled: check.boolean,
  connection: check.object({ status: check.choice('online', 'offline'), lastSeenAt: check.nullable(check.integer()) }) });
const messageBody = check.refine(check.plainText(16384), body => !!body.trim() && body.length <= 4096, 'Expected a fleet message of 1–4096 characters');
export const fleetMessageCommand = check.object({ messageId: check.identifier, fleetId: check.identifier, body: messageBody,
  createdAt: check.integer(), expiresAt: check.integer(), sender: check.refine(check.object({ kind: check.choice('human', 'controller'),
    matrixUserId: check.nullable(check.matrixUserId) }), sender => (sender.kind === 'human') === (sender.matrixUserId !== null), 'Invalid fleet message sender'),
  agentIds: check.list(check.identifier, 100) });
export const fleetControlSnapshot = check.refine(check.object({ fleetId: check.identifier, revision: check.integer(), deliveryEnabled: check.boolean,
  connection: check.object({ status: check.choice('online', 'offline'), lastSeenAt: check.nullable(check.integer()) }),
  agentIds: check.list(check.identifier, 100), messages: check.list(fleetMessageCommand, 1) }), snapshot =>
  new Set(snapshot.agentIds).size === snapshot.agentIds.length && snapshot.messages.every(message => message.fleetId === snapshot.fleetId
    && message.expiresAt > message.createdAt && new Set(message.agentIds).size === message.agentIds.length), 'Invalid fleet control snapshot');
export const fleetMessageSummary = check.object({ messageId: check.identifier, body: messageBody, createdAt: check.integer(), expiresAt: check.integer(),
  total: check.integer(0, 100), delivered: check.integer(0, 100), failed: check.integer(0, 100), skipped: check.integer(0, 100), pending: check.integer(0, 100), expired: check.integer(0, 100) });
export const fleetMessageReceipt = check.object({ messageId: check.identifier, agentId: check.identifier, status: check.choice('pending', 'delivered', 'failed', 'skipped'),
  completedAt: check.nullable(check.integer()), errorMessage: check.nullable(check.text(1000)) });
export const deliveryChange = check.object({ expectedRevision: check.integer(), enabled: check.boolean });
export const messageCreation = check.object({ messageId: check.identifier, body: messageBody });
export const connectionReport = check.object({ stopped: check.boolean });
export const receiptReport = check.object({ status: check.choice('delivered', 'failed', 'skipped'), errorMessage: check.nullable(check.text(1000)) });
export function controlQuery(input: unknown) {
  const values = listQuery(['connectionId', 'revision', 'waitMs'])(input); if (!values.ok) return values;
  const connectionId = check.identifier(values.value.get('connectionId'));
  const revision = queryInteger(values.value.get('revision'), 0, Number.MAX_SAFE_INTEGER);
  const waitMs = queryInteger(values.value.get('waitMs'), 0, 10000);
  if (!connectionId.ok) return connectionId;
  if (!values.value.has('revision') || !revision.ok || !values.value.has('waitMs') || !waitMs.ok) return failure('invalid', 'A revision and bounded waitMs are required');
  return success({ connectionId: connectionId.value, revision: revision.value, waitMs: waitMs.value });
}
export function messagePage(input: unknown) {
  const values = listQuery(['page', 'pageSize'])(input); if (!values.ok) return values;
  const page = queryInteger(values.value.get('page') ?? '1', 1, 100000);
  const pageSize = queryInteger(values.value.get('pageSize') ?? '10', 1, 10);
  if (!page.ok) return page; if (!pageSize.ok) return pageSize;
  return success({ page: page.value, pageSize: pageSize.value });
}
function queryInteger(value: string | null, minimum: number, maximum: number) {
  return value !== null && /^(0|[1-9][0-9]*)$/u.test(value) ? check.integer(minimum, maximum)(Number(value)) : failure('invalid', 'Use a canonical integer query value');
}
export type FleetControl = Parsed<typeof fleetControl>;
export type FleetControlSnapshot = Parsed<typeof fleetControlSnapshot>;
export type FleetMessageCommand = Parsed<typeof fleetMessageCommand>;
