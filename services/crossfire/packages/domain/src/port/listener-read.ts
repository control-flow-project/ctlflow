import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { Page, PageRequest } from './directory.js';
import type { ListenerRun } from '../activity/types.js';
import type { FleetConnection } from '../fleet/control-types.js';
import type { NativeStop } from '../fleet/native-stop.js';
export type ActivityTotals = { agentId: string; messagesDelivered: number; activeMs: number; lastSeenAt: number | null };
export type RetirementSelection = { agentIds: string[]; fleetIds?: never } | { fleetIds: string[]; agentIds?: never };
export type RetirementAgent = {
  agentId: string; fleetId: string; ownerActive: boolean; pendingOperation: boolean;
  pendingDecision: boolean; pendingWake: boolean; pendingBroadcast: boolean; hasObservedRuntime: boolean;
  latestRun: Pick<ListenerRun, 'id' | 'controller' | 'stoppedAt'> | null;
  latestActiveObservationAt: number | null; nativeStop: NativeStop | null;
  controller: (FleetConnection & { credential: { id: string; fleetId: string; revokedAt: number | null } | null }) | null;
};
export type RetirementSnapshot = { agents: RetirementAgent[]; pendingFleetIds: string[] };
export type ListenerReadRepository = {
  activeCount(agentId: string, since: number, now: number): Result<number>;
  reportingAgentIds(since: number, disconnecting: boolean, now: number): Result<string[]>;
  totals(agentIds: string[]): Result<ActivityTotals[]>;
  active(agentIds: string[], since: number): Result<ListenerRun[]>;
  history(agentId: string, page: PageRequest): Result<Page<ListenerRun>>;
  retirement(selection: RetirementSelection, now: number): Result<RetirementSnapshot>;
};
