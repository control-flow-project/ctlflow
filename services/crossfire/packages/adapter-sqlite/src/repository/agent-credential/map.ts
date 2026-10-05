import type { AgentCredential } from '@ctlflow/crossfire-domain/identity/types';
import type { Tables } from '../../schema/tables.js';
export function mapAgentCredential(row: Tables['agent_credential']): AgentCredential {
  return {
    agentId: row.agent_id,
    provisioningPassword: row.provisioning_password,
    accessToken: row.access_token,
    updatedAt: row.updated_at,
  };
}
