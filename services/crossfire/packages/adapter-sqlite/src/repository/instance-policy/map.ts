import type { InstancePolicy } from '@crossfire/domain/audit/types';
import type { Tables } from '../../schema/tables.js';
export function mapInstancePolicy(row: Tables['instance_policy']): InstancePolicy {
  return {
    id: row.id,
    revision: row.revision,
    maxOwnerAgents: row.max_owner_agents,
    maxAgents: row.max_agents,
    maxPending: row.max_pending,
    enrollmentSeconds: row.enrollment_seconds,
    reconcileSeconds: row.reconcile_seconds,
    maxMessageBytes: row.max_message_bytes,
    fleetIdleTimeoutSeconds: row.fleet_idle_timeout_seconds,
    agentInstructions: row.agent_instructions,
    signupMode: row.signup_mode,
    invitationIssuers: row.invitation_issuers,
  };
}
