import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { Agent } from '../identity/types.js';
import type { WakeSelection, BackendWakeSelection } from '../wake/types.js';

export type RequestedFleetPolicy = {
  wakeMode: Agent['wakeMode'];
  senders: WakeSelection[];
  permissions: 'room.agent.invite'[];
  expectedAgentRevision: number | null;
};
export type ApprovedFleetPolicy = {
  agentId: string;
  approvedByMemberId: string;
  approvedAt: number;
  permissions: 'room.agent.invite'[];
};
export type FleetPolicyKey = { requestId: string; instanceKey: string };
export type RequestedFleetPolicyRecord = RequestedFleetPolicy & { instanceKey: string; backendSenders: BackendWakeSelection[] };
export type FleetPolicyRepository = {
  requested(requestId: string): Result<RequestedFleetPolicyRecord[]>;
  insertRequested(key: FleetPolicyKey, policy: RequestedFleetPolicy): Result<void>;
  approved(agentId: string): Result<ApprovedFleetPolicy | null>;
  approve(policy: ApprovedFleetPolicy): Result<void>;
};
