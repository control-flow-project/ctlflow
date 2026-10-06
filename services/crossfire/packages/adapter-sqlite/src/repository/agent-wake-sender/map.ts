import type { AgentWakeSender } from '@ctlflow/crossfire-domain/room-access/types';
import type { Tables } from '../../schema/tables.js';
export function mapAgentWakeSender(row: Tables['agent_wake_sender']): AgentWakeSender {
  return {
    agentId: row.agent_id,
    senderPrincipalId: row.sender_principal_id,
    includeAgents: row.include_agents === 1,
  };
}
