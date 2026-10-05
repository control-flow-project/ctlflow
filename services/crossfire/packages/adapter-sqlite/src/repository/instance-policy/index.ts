import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { mapInstancePolicy } from './map.js';
import { stored } from '../stored.js';
import { failure, success } from '@crossfire/kernel/result';
import type { InstancePolicyRepository } from '@crossfire/domain/port/repositories';

export function createInstancePolicyRepository(database: Database.Database): InstancePolicyRepository {
  return {
    find(key) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('instance_policy')
          .where(row => row.id === params.id).firstOrDefault(), key);
        return success(row ? mapInstancePolicy(row) : null);
      });
    },
    insert(value) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('instance_policy').values({
      id: params.id,
      revision: params.revision,
      max_owner_agents: params.maxOwnerAgents,
      max_agents: params.maxAgents,
      max_pending: params.maxPending,
      enrollment_seconds: params.enrollmentSeconds,
      reconcile_seconds: params.reconcileSeconds,
      max_message_bytes: params.maxMessageBytes,
      fleet_idle_timeout_seconds: params.fleetIdleTimeoutSeconds,
      agent_instructions: params.agentInstructions,
      signup_mode: params.signupMode,
      invitation_issuers: params.invitationIssuers,
        }), value);
        return success(undefined);
      });
    },
    update(value) {
      return stored(() => {
        const changed = executeUpdate(database, schema, (query, params) => query.update('instance_policy').set({
      revision: params.revision,
      max_owner_agents: params.maxOwnerAgents,
      max_agents: params.maxAgents,
      max_pending: params.maxPending,
      enrollment_seconds: params.enrollmentSeconds,
      reconcile_seconds: params.reconcileSeconds,
      max_message_bytes: params.maxMessageBytes,
      fleet_idle_timeout_seconds: params.fleetIdleTimeoutSeconds,
      agent_instructions: params.agentInstructions,
      signup_mode: params.signupMode,
      invitation_issuers: params.invitationIssuers,
        }).where(row => row.id === params.id), value);
        return changed === 1 ? success(undefined) : failure('missing', 'InstancePolicy not found');
      });
    },
  };
}
