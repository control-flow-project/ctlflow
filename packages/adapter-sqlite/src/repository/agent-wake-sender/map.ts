import type { AgentWakeSender } from '../../../../domain/src/room-access/types.js';
import type { Tables } from '../../schema/tables.js';
export function mapAgentWakeSender(row: Tables['agent_wake_sender']): AgentWakeSender {
  return {
    agentId: row.agent_id,
    senderPrincipalId: row.sender_principal_id,
  };
}
