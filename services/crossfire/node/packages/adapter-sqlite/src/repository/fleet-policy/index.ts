import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { success } from '@ctlflow/crossfire-kernel/result';
import type { FleetPolicyRepository } from '@ctlflow/crossfire-domain/port/fleet-policy';
import { schema } from '../../schema/tables.js';
import { stored } from '../stored.js';

export function createFleetPolicyRepository(database: Database.Database): FleetPolicyRepository {
  return {
    requested(requestId) {
      return stored(() => {
        const policies = executeSelect(database, schema, (query, params) => query.from('enrollment_item_policy')
          .where(row => row.request_id === params.requestId).orderBy(row => row.instance_key), { requestId });
        if (!policies.length) return success([]);
        const senders = executeSelect(database, schema, (query, params) => query.from('enrollment_item_wake_sender')
          .join(query.from('principal'), sender => sender.sender_principal_id, principal => principal.id, (sender, principal) => ({ sender, principal }))
          .where(row => row.sender.request_id === params.requestId)
          .orderBy(row => row.sender.instance_key).thenBy(row => row.sender.sender_principal_id)
          .select(row => ({ instanceKey: row.sender.instance_key, principalId: row.sender.sender_principal_id, matrixUserId: row.principal.matrix_user_id,
            includeAgents: row.sender.include_agents })), { requestId });
        const permissions = executeSelect(database, schema, (query, params) => query.from('enrollment_item_permission')
          .where(row => row.request_id === params.requestId).orderBy(row => row.instance_key).thenBy(row => row.permission_code), { requestId });
        const bySender = new Map<string, typeof senders>(), byPermission = new Map<string, 'room.agent.invite'[]>();
        for (const sender of senders) {
          const group = bySender.get(sender.instanceKey) ?? []; group.push(sender); bySender.set(sender.instanceKey, group);
        }
        for (const permission of permissions) {
          const group = byPermission.get(permission.instance_key) ?? []; group.push(permission.permission_code); byPermission.set(permission.instance_key, group);
        }
        return success(policies.map(policy => ({ instanceKey: policy.instance_key, wakeMode: policy.wake_mode,
          expectedAgentRevision: policy.expected_agent_revision, senders: (bySender.get(policy.instance_key) ?? []).map(sender => ({ principalId: sender.principalId, includeAgents: sender.includeAgents === 1 })),
          matrixSenders: (bySender.get(policy.instance_key) ?? []).map(sender => ({ matrixUserId: sender.matrixUserId, includeAgents: sender.includeAgents === 1 })), permissions: byPermission.get(policy.instance_key) ?? [] })));
      });
    },
    insertRequested(key, policy) {
      return stored(() => {
        executeInsert(database, schema, (query, params) => query.insertInto('enrollment_item_policy').values({
          request_id: params.requestId, instance_key: params.instanceKey, wake_mode: params.wakeMode,
          expected_agent_revision: params.expectedAgentRevision }), { ...key, ...policy });
        for (const sender of policy.senders) executeInsert(database, schema, (query, params) => query.insertInto('enrollment_item_wake_sender').values({
          request_id: params.requestId, instance_key: params.instanceKey, sender_principal_id: params.principalId,
          include_agents: params.includeAgents }), { ...key, ...sender, includeAgents: sender.includeAgents ? 1 : 0 });
        for (const permissionCode of policy.permissions) executeInsert(database, schema, (query, params) => query.insertInto('enrollment_item_permission').values({
          request_id: params.requestId, instance_key: params.instanceKey, permission_code: params.permissionCode, grant_scope: 'agent_room' }), { ...key, permissionCode });
        return success(undefined);
      });
    },
    approved(agentId) {
      return stored(() => {
        const policy = executeSelect(database, schema, (query, params) => query.from('fleet_instance_policy')
          .where(row => row.agent_id === params.agentId).firstOrDefault(), { agentId });
        if (!policy) return success(null);
        const permissions = executeSelect(database, schema, (query, params) => query.from('fleet_instance_permission')
          .where(row => row.agent_id === params.agentId).orderBy(row => row.permission_code), { agentId });
        return success({ agentId, approvedByMemberId: policy.approved_by_member_id, approvedAt: policy.approved_at,
          permissions: permissions.map(row => row.permission_code) });
      });
    },
    approve(policy) {
      return stored(() => {
        const previous = executeSelect(database, schema, (query, params) => query.from('fleet_instance_policy')
          .where(row => row.agent_id === params.agentId).firstOrDefault(), policy);
        if (previous) executeUpdate(database, schema, (query, params) => query.update('fleet_instance_policy').set({
          approved_by_member_id: params.approvedByMemberId, approved_at: params.approvedAt }).where(row => row.agent_id === params.agentId), policy);
        else executeInsert(database, schema, (query, params) => query.insertInto('fleet_instance_policy').values({
          agent_id: params.agentId, approved_by_member_id: params.approvedByMemberId, approved_at: params.approvedAt }), policy);
        executeDelete(database, schema, (query, params) => query.deleteFrom('fleet_instance_permission').where(row => row.agent_id === params.agentId), policy);
        for (const permissionCode of policy.permissions) executeInsert(database, schema, (query, params) => query.insertInto('fleet_instance_permission').values({
          agent_id: params.agentId, permission_code: params.permissionCode, grant_scope: 'agent_room' }), { agentId: policy.agentId, permissionCode });
        return success(undefined);
      });
    },
  };
}
