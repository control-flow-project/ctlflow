import * as check from './schema/validation.js';

export const runtimeAction = check.choice('start', 'stop', 'reset');
export const runtimeOperation = check.refine(check.object({ operationId: check.identifier, fleetId: check.identifier,
  agentId: check.nullable(check.identifier), action: runtimeAction, expectedRevision: check.integer(),
  status: check.choice('pending', 'running', 'succeeded', 'failed'), createdAt: check.integer(), completedAt: check.nullable(check.integer()),
  errorMessage: check.nullable(check.text(4096)) }), value =>
  (value.status === 'succeeded' || value.status === 'failed') === (value.completedAt !== null)
  && (value.status === 'failed') === (value.errorMessage !== null), 'Invalid session operation outcome');
export const runtimeRequest = check.refine(check.object({ operationId: check.identifier, agentId: check.nullable(check.identifier),
  action: runtimeAction, expectedRevision: check.integer(), confirmFreshHistory: check.boolean }), value =>
  value.confirmFreshHistory === (value.action === 'reset'), 'Fresh history requires explicit confirmation');
export const runtimeClaim = check.object({ connectionId: check.identifier });
export const runtimeReceipt = check.refine(check.object({ connectionId: check.identifier, status: check.choice('succeeded', 'failed'),
  errorMessage: check.nullable(check.text(4096)) }), value => (value.status === 'failed') === (value.errorMessage !== null), 'Invalid session receipt');
export type FleetRuntimeOperation = check.Parsed<typeof runtimeOperation>;
