import type { AgentName } from '@ctlflow/crossfire-domain/enrollment/types';
import type { Tables } from '../../schema/tables.js';
export function mapAgentName(row: Tables['agent_name']): AgentName {
  return {
    name: row.name,
    requestId: row.request_id,
    instanceKey: row.instance_key,
    agentId: row.agent_id,
  };
}
