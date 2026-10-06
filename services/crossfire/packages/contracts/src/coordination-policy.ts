import * as check from './schema/validation.js';
import type { CoordinationPolicy } from '@ctlflow/crossfire-domain/coordination/values';
export type { CoordinationPolicy } from '@ctlflow/crossfire-domain/coordination/values';

export const matrixWakeSelection = check.object({ matrixUserId: check.matrixUserId, includeAgents: check.boolean });
export const coordinationPolicy = check.refine(check.object({ wakeMode: check.wakeMode,
  senders: check.list(matrixWakeSelection, 2000), permissions: check.list(check.choice('room.agent.invite'), 1) }),
  policy => (policy.wakeMode !== 'everyone' || policy.senders.length === 0)
    && new Set(policy.senders.map(sender => sender.matrixUserId)).size === policy.senders.length,
  'Select unique identities; everyone requires no individual selections') satisfies check.Parser<CoordinationPolicy>;
export function defaultCoordinationPolicy(ownerMatrixId: string): CoordinationPolicy {
  return { wakeMode: 'selected', senders: [{ matrixUserId: ownerMatrixId, includeAgents: false }], permissions: [] };
}
