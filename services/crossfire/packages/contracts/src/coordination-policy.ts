import * as check from './schema/validation.js';

export const coordinationPolicy = check.refine(check.object({ wakeMode: check.wakeMode,
  senderMatrixIds: check.list(check.matrixUserId, 2000), permissions: check.list(check.choice('room.agent.invite'), 1) }),
  policy => (policy.wakeMode === 'selected' || policy.senderMatrixIds.length === 0)
    && new Set(policy.senderMatrixIds).size === policy.senderMatrixIds.length,
  'Selected identities must be unique and are only valid for selected wake authority');
export type CoordinationPolicy = check.Parsed<typeof coordinationPolicy>;
export function defaultCoordinationPolicy(): CoordinationPolicy {
  return { wakeMode: 'owner', senderMatrixIds: [], permissions: [] };
}
