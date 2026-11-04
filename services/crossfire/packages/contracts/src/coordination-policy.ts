import * as check from './schema/validation.js';
import type { CoordinationPolicy } from '@ctlflow/crossfire-domain/coordination/values';
export type { CoordinationPolicy } from '@ctlflow/crossfire-domain/coordination/values';

export const backendWakeSelection = check.object({ backendUserId: check.backendUserId, includeAgents: check.boolean });
export const coordinationPolicy = check.refine(check.object({ wakeMode: check.wakeMode,
  senders: check.list(backendWakeSelection, 2000), permissions: check.list(check.choice('room.agent.invite'), 1) }),
  policy => (policy.wakeMode !== 'everyone' || policy.senders.length === 0)
    && new Set(policy.senders.map(sender => sender.backendUserId)).size === policy.senders.length,
  'Select unique identities; everyone requires no individual selections') satisfies check.Parser<CoordinationPolicy>;
export function defaultCoordinationPolicy(ownerBackendUserId: string): CoordinationPolicy {
  return { wakeMode: 'selected', senders: [{ backendUserId: ownerBackendUserId, includeAgents: false }], permissions: [] };
}
