import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import { agentDisplayName } from '@ctlflow/crossfire-domain/identity/display-name';
import type Database from 'better-sqlite3';
import { schema, type Tables } from '../../schema/tables.js';
import type { DirectoryRepository, Page, PageRequest, MemberRecord, AgentRecord, DirectoryFilter } from '@ctlflow/crossfire-domain/port/directory';
import { success } from '@ctlflow/crossfire-kernel/result';
import { stored } from '../stored.js';
import { mapPrincipal } from '../principal/map.js';

type MemberRow = {
  member_principal_id: Tables['member']['principal_id'];
  member_principal_kind: Tables['member']['principal_kind'];
  member_display_name: Tables['member']['display_name'];
  principal_id: Tables['principal']['id'];
  principal_matrix_user_id: Tables['principal']['matrix_user_id'];
  principal_kind: Tables['principal']['kind'];
  principal_status: Tables['principal']['status'];
  principal_revision: Tables['principal']['revision'];
  principal_created_at: Tables['principal']['created_at'];
  role_principal_id: Tables['principal_role']['principal_id'];
  role_principal_kind: Tables['principal_role']['principal_kind'];
  role_role_code: Tables['principal_role']['role_code'];
  role_assigned_by_member_id: Tables['principal_role']['assigned_by_member_id'];
  role_assigned_at: Tables['principal_role']['assigned_at'];
  application_principal_id: Tables['principal_application']['principal_id'];
  application_applied_revision: Tables['principal_application']['applied_revision'];
  application_applied_intent_hash: Tables['principal_application']['applied_intent_hash'];
  application_applied_status: Tables['principal_application']['applied_status'];
  application_native_display_name: Tables['principal_application']['native_display_name'];
  application_last_attempt_at: Tables['principal_application']['last_attempt_at'];
  application_last_success_at: Tables['principal_application']['last_success_at'];
  application_next_check_at: Tables['principal_application']['next_check_at'];
  application_error_code: Tables['principal_application']['error_code'];
  application_error_message: Tables['principal_application']['error_message'];
};
type AgentRow = {
  agent_principal_id: Tables['agent']['principal_id'];
  agent_principal_kind: Tables['agent']['principal_kind'];
  agent_owner_id: Tables['agent']['owner_id'];
  agent_display_name_override: Tables['agent']['display_name_override'];
  agent_wake_mode: Tables['agent']['wake_mode'];
  principal_id: Tables['principal']['id'];
  principal_matrix_user_id: Tables['principal']['matrix_user_id'];
  principal_kind: Tables['principal']['kind'];
  principal_status: Tables['principal']['status'];
  principal_revision: Tables['principal']['revision'];
  principal_created_at: Tables['principal']['created_at'];
  application_principal_id: Tables['principal_application']['principal_id'];
  application_applied_revision: Tables['principal_application']['applied_revision'];
  application_applied_intent_hash: Tables['principal_application']['applied_intent_hash'];
  application_applied_status: Tables['principal_application']['applied_status'];
  application_native_display_name: Tables['principal_application']['native_display_name'];
  application_last_attempt_at: Tables['principal_application']['last_attempt_at'];
  application_last_success_at: Tables['principal_application']['last_success_at'];
  application_next_check_at: Tables['principal_application']['next_check_at'];
  application_error_code: Tables['principal_application']['error_code'];
  application_error_message: Tables['principal_application']['error_message'];
  owner_id: Tables['principal']['id'];
  owner_matrix_user_id: Tables['principal']['matrix_user_id'];
  owner_kind: Tables['principal']['kind'];
  owner_status: Tables['principal']['status'];
  owner_revision: Tables['principal']['revision'];
  owner_created_at: Tables['principal']['created_at'];
  ownerMember_principal_id: Tables['member']['principal_id'];
  ownerMember_principal_kind: Tables['member']['principal_kind'];
  ownerMember_display_name: Tables['member']['display_name'];
  name: string;
};
function memberRecord(row: MemberRow): MemberRecord { return {
    member: { principalId: row.member_principal_id, principalKind: row.member_principal_kind, displayName: row.member_display_name },
    principal: { id: row.principal_id, matrixUserId: row.principal_matrix_user_id, kind: row.principal_kind, status: row.principal_status, revision: row.principal_revision, createdAt: row.principal_created_at },
    role: { principalId: row.role_principal_id, principalKind: row.role_principal_kind, roleCode: row.role_role_code, assignedByMemberId: row.role_assigned_by_member_id, assignedAt: row.role_assigned_at },
    application: { principalId: row.application_principal_id, appliedRevision: row.application_applied_revision, appliedIntentHash: row.application_applied_intent_hash, appliedStatus: row.application_applied_status, nativeDisplayName: row.application_native_display_name, lastAttemptAt: row.application_last_attempt_at, lastSuccessAt: row.application_last_success_at, nextCheckAt: row.application_next_check_at, errorCode: row.application_error_code, errorMessage: row.application_error_message }
  }; }
function agentRecord(row: AgentRow): AgentRecord { return {
    agent: { principalId: row.agent_principal_id, principalKind: row.agent_principal_kind, ownerId: row.agent_owner_id, displayNameOverride: row.agent_display_name_override, wakeMode: row.agent_wake_mode },
    principal: { id: row.principal_id, matrixUserId: row.principal_matrix_user_id, kind: row.principal_kind, status: row.principal_status, revision: row.principal_revision, createdAt: row.principal_created_at },
    application: { principalId: row.application_principal_id, appliedRevision: row.application_applied_revision, appliedIntentHash: row.application_applied_intent_hash, appliedStatus: row.application_applied_status, nativeDisplayName: row.application_native_display_name, lastAttemptAt: row.application_last_attempt_at, lastSuccessAt: row.application_last_success_at, nextCheckAt: row.application_next_check_at, errorCode: row.application_error_code, errorMessage: row.application_error_message },
    owner: { id: row.owner_id, matrixUserId: row.owner_matrix_user_id, kind: row.owner_kind, status: row.owner_status, revision: row.owner_revision, createdAt: row.owner_created_at },
    ownerMember: { principalId: row.ownerMember_principal_id, principalKind: row.ownerMember_principal_kind, displayName: row.ownerMember_display_name }, name: row.name
  }; }
export function page<T>(items: T[], totalItems: number, input: PageRequest): Page<T> {
  return { items, totalItems, page: input.page, pageSize: input.pageSize, totalPages: Math.ceil(totalItems / input.pageSize) };
}

function allAgents(database: Database.Database, filter: DirectoryFilter): Page<AgentRecord> {
  const params = { filterIds: filter.agentIds !== undefined, agentIds: filter.agentIds ?? [], ownerId: filter.ownerId ?? '', statuses: filter.statuses, search: filter.search, offset: (filter.page - 1) * filter.pageSize, limit: filter.pageSize, activityMode: filter.activity?.mode ?? 'all', activityIds: filter.activity?.agentIds ?? [] };
  const total = executeSelect(database, schema, (query, params) => query.from('agent')
  .join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
  .join(query.from('fleet_instance'), row => row.agent.principal_id, instance => instance.agent_id, (row, instance) => ({ ...row, instance }))
  .join(query.from('fleet'), row => row.agent.owner_id, fleet => fleet.owner_id, (row, fleet) => ({ ...row, fleet }))
  .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
  .join(query.from('principal_application'), row => row.agent.principal_id, application => application.principal_id,
    (row, application) => ({ ...row, application }))
  .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id,
    (row, owner) => ({ ...row, owner }))
  .join(query.from('member'), row => row.agent.owner_id, ownerMember => ownerMember.principal_id,
    (row, ownerMember) => ({ ...row, ownerMember })).where(row => row.instance.retired_at === null && row.fleet.archived_at === null && row.instance.fleet_key === row.fleet.fleet_key && (params.filterIds === false || params.agentIds.includes(row.principal.id)) && params.statuses.includes(row.principal.status) && (row.name.name.includes(params.search) || row.principal.matrix_user_id.includes(params.search)) && (params.activityMode === 'all' || params.activityMode === 'include' && params.activityIds.includes(row.principal.id) && row.principal.status === 'active' && row.owner.status === 'active' || params.activityMode === 'exclude' && (!params.activityIds.includes(row.principal.id) || row.principal.status !== 'active' || row.owner.status !== 'active'))).count(), params);
  const rows = executeSelect(database, schema, (query, params) => query.from('agent')
  .join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
  .join(query.from('fleet_instance'), row => row.agent.principal_id, instance => instance.agent_id, (row, instance) => ({ ...row, instance }))
  .join(query.from('fleet'), row => row.agent.owner_id, fleet => fleet.owner_id, (row, fleet) => ({ ...row, fleet }))
  .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
  .join(query.from('principal_application'), row => row.agent.principal_id, application => application.principal_id,
    (row, application) => ({ ...row, application }))
  .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id,
    (row, owner) => ({ ...row, owner }))
  .join(query.from('member'), row => row.agent.owner_id, ownerMember => ownerMember.principal_id,
    (row, ownerMember) => ({ ...row, ownerMember })).where(row => row.instance.retired_at === null && row.fleet.archived_at === null && row.instance.fleet_key === row.fleet.fleet_key && (params.filterIds === false || params.agentIds.includes(row.principal.id)) && params.statuses.includes(row.principal.status) && (row.name.name.includes(params.search) || row.principal.matrix_user_id.includes(params.search)) && (params.activityMode === 'all' || params.activityMode === 'include' && params.activityIds.includes(row.principal.id) && row.principal.status === 'active' && row.owner.status === 'active' || params.activityMode === 'exclude' && (!params.activityIds.includes(row.principal.id) || row.principal.status !== 'active' || row.owner.status !== 'active')))
    .orderBy(row => row.principal.created_at).thenBy(row => row.principal.id).skip(params.offset).take(params.limit).select(row => ({
      agent_principal_id: row.agent.principal_id,
      agent_principal_kind: row.agent.principal_kind,
      agent_owner_id: row.agent.owner_id,
      agent_display_name_override: row.agent.display_name_override,
      agent_wake_mode: row.agent.wake_mode,
      principal_id: row.principal.id,
      principal_matrix_user_id: row.principal.matrix_user_id,
      principal_kind: row.principal.kind,
      principal_status: row.principal.status,
      principal_revision: row.principal.revision,
      principal_created_at: row.principal.created_at,
      application_principal_id: row.application.principal_id,
      application_applied_revision: row.application.applied_revision,
      application_applied_intent_hash: row.application.applied_intent_hash,
      application_applied_status: row.application.applied_status,
      application_native_display_name: row.application.native_display_name,
      application_last_attempt_at: row.application.last_attempt_at,
      application_last_success_at: row.application.last_success_at,
      application_next_check_at: row.application.next_check_at,
      application_error_code: row.application.error_code,
      application_error_message: row.application.error_message,
      owner_id: row.owner.id,
      owner_matrix_user_id: row.owner.matrix_user_id,
      owner_kind: row.owner.kind,
      owner_status: row.owner.status,
      owner_revision: row.owner.revision,
      owner_created_at: row.owner.created_at,
      ownerMember_principal_id: row.ownerMember.principal_id,
      ownerMember_principal_kind: row.ownerMember.principal_kind,
      ownerMember_display_name: row.ownerMember.display_name,
      name: row.name.name
    })), params);
  return page(rows.map(agentRecord), total, filter);
}

function ownedAgents(database: Database.Database, filter: DirectoryFilter): Page<AgentRecord> {
  const params = { filterIds: filter.agentIds !== undefined, agentIds: filter.agentIds ?? [], ownerId: filter.ownerId ?? '', statuses: filter.statuses, search: filter.search, offset: (filter.page - 1) * filter.pageSize, limit: filter.pageSize, activityMode: filter.activity?.mode ?? 'all', activityIds: filter.activity?.agentIds ?? [] };
  const total = executeSelect(database, schema, (query, params) => query.from('agent')
  .join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
  .join(query.from('fleet_instance'), row => row.agent.principal_id, instance => instance.agent_id, (row, instance) => ({ ...row, instance }))
  .join(query.from('fleet'), row => row.agent.owner_id, fleet => fleet.owner_id, (row, fleet) => ({ ...row, fleet }))
  .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
  .join(query.from('principal_application'), row => row.agent.principal_id, application => application.principal_id,
    (row, application) => ({ ...row, application }))
  .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id,
    (row, owner) => ({ ...row, owner }))
  .join(query.from('member'), row => row.agent.owner_id, ownerMember => ownerMember.principal_id,
    (row, ownerMember) => ({ ...row, ownerMember })).where(row => row.instance.retired_at === null && row.fleet.archived_at === null && row.instance.fleet_key === row.fleet.fleet_key && row.agent.owner_id === params.ownerId && (params.filterIds === false || params.agentIds.includes(row.principal.id)) && params.statuses.includes(row.principal.status) && (row.name.name.includes(params.search) || row.principal.matrix_user_id.includes(params.search)) && (params.activityMode === 'all' || params.activityMode === 'include' && params.activityIds.includes(row.principal.id) && row.principal.status === 'active' && row.owner.status === 'active' || params.activityMode === 'exclude' && (!params.activityIds.includes(row.principal.id) || row.principal.status !== 'active' || row.owner.status !== 'active'))).count(), params);
  const rows = executeSelect(database, schema, (query, params) => query.from('agent')
  .join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
  .join(query.from('fleet_instance'), row => row.agent.principal_id, instance => instance.agent_id, (row, instance) => ({ ...row, instance }))
  .join(query.from('fleet'), row => row.agent.owner_id, fleet => fleet.owner_id, (row, fleet) => ({ ...row, fleet }))
  .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
  .join(query.from('principal_application'), row => row.agent.principal_id, application => application.principal_id,
    (row, application) => ({ ...row, application }))
  .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id,
    (row, owner) => ({ ...row, owner }))
  .join(query.from('member'), row => row.agent.owner_id, ownerMember => ownerMember.principal_id,
    (row, ownerMember) => ({ ...row, ownerMember })).where(row => row.instance.retired_at === null && row.fleet.archived_at === null && row.instance.fleet_key === row.fleet.fleet_key && row.agent.owner_id === params.ownerId && (params.filterIds === false || params.agentIds.includes(row.principal.id)) && params.statuses.includes(row.principal.status) && (row.name.name.includes(params.search) || row.principal.matrix_user_id.includes(params.search)) && (params.activityMode === 'all' || params.activityMode === 'include' && params.activityIds.includes(row.principal.id) && row.principal.status === 'active' && row.owner.status === 'active' || params.activityMode === 'exclude' && (!params.activityIds.includes(row.principal.id) || row.principal.status !== 'active' || row.owner.status !== 'active')))
    .orderBy(row => row.principal.created_at).thenBy(row => row.principal.id).skip(params.offset).take(params.limit).select(row => ({
      agent_principal_id: row.agent.principal_id,
      agent_principal_kind: row.agent.principal_kind,
      agent_owner_id: row.agent.owner_id,
      agent_display_name_override: row.agent.display_name_override,
      agent_wake_mode: row.agent.wake_mode,
      principal_id: row.principal.id,
      principal_matrix_user_id: row.principal.matrix_user_id,
      principal_kind: row.principal.kind,
      principal_status: row.principal.status,
      principal_revision: row.principal.revision,
      principal_created_at: row.principal.created_at,
      application_principal_id: row.application.principal_id,
      application_applied_revision: row.application.applied_revision,
      application_applied_intent_hash: row.application.applied_intent_hash,
      application_applied_status: row.application.applied_status,
      application_native_display_name: row.application.native_display_name,
      application_last_attempt_at: row.application.last_attempt_at,
      application_last_success_at: row.application.last_success_at,
      application_next_check_at: row.application.next_check_at,
      application_error_code: row.application.error_code,
      application_error_message: row.application.error_message,
      owner_id: row.owner.id,
      owner_matrix_user_id: row.owner.matrix_user_id,
      owner_kind: row.owner.kind,
      owner_status: row.owner.status,
      owner_revision: row.owner.revision,
      owner_created_at: row.owner.created_at,
      ownerMember_principal_id: row.ownerMember.principal_id,
      ownerMember_principal_kind: row.ownerMember.principal_kind,
      ownerMember_display_name: row.ownerMember.display_name,
      name: row.name.name
    })), params);
  return page(rows.map(agentRecord), total, filter);
}

export function createDirectoryRepository(database: Database.Database): DirectoryRepository {
  return {
    deployments(agentIds) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('fleet_instance')
        .join(query.from('fleet'), instance => instance.owner_id, fleet => fleet.owner_id, (instance, fleet) => ({ instance, fleet }))
        .where(row => row.instance.retired_at === null && row.fleet.archived_at === null && row.instance.fleet_key === row.fleet.fleet_key && params.agentIds.includes(row.instance.agent_id)).orderBy(row => row.instance.agent_id)
        .select(row => ({ agentId: row.instance.agent_id, fleetId: row.fleet.id, fleetKey: row.fleet.fleet_key, label: row.fleet.label,
          controllerName: row.fleet.controller_name, reportedAt: row.fleet.updated_at, instanceKey: row.instance.instance_key })), { agentIds })));
    },
    principalByMatrixId(matrixUserId) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('principal').where(row => row.matrix_user_id === params.matrixUserId).firstOrDefault(), { matrixUserId });
        return success(row ? mapPrincipal(row) : null);
      });
    },
    member(principalId) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('member').join(query.from('principal'), member => member.principal_id, principal => principal.id, (member, principal) => ({ member, principal }))
  .join(query.from('principal_role'), row => row.member.principal_id, role => role.principal_id, (row, role) => ({ ...row, role }))
  .join(query.from('principal_application'), row => row.member.principal_id, application => application.principal_id,
    (row, application) => ({ ...row, application })).where(row => row.principal.id === params.principalId).select(row => ({ member_principal_id: row.member.principal_id,
      member_principal_kind: row.member.principal_kind,
      member_display_name: row.member.display_name,
      principal_id: row.principal.id,
      principal_matrix_user_id: row.principal.matrix_user_id,
      principal_kind: row.principal.kind,
      principal_status: row.principal.status,
      principal_revision: row.principal.revision,
      principal_created_at: row.principal.created_at,
      role_principal_id: row.role.principal_id,
      role_principal_kind: row.role.principal_kind,
      role_role_code: row.role.role_code,
      role_assigned_by_member_id: row.role.assigned_by_member_id,
      role_assigned_at: row.role.assigned_at,
      application_principal_id: row.application.principal_id,
      application_applied_revision: row.application.applied_revision,
      application_applied_intent_hash: row.application.applied_intent_hash,
      application_applied_status: row.application.applied_status,
      application_native_display_name: row.application.native_display_name,
      application_last_attempt_at: row.application.last_attempt_at,
      application_last_success_at: row.application.last_success_at,
      application_next_check_at: row.application.next_check_at,
      application_error_code: row.application.error_code,
      application_error_message: row.application.error_message })).firstOrDefault(), { principalId });
        return success(row ? memberRecord(row) : null);
      });
    },
    agent(principalId) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('agent')
  .join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
  .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
  .join(query.from('principal_application'), row => row.agent.principal_id, application => application.principal_id,
    (row, application) => ({ ...row, application }))
  .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id,
    (row, owner) => ({ ...row, owner }))
  .join(query.from('member'), row => row.agent.owner_id, ownerMember => ownerMember.principal_id,
    (row, ownerMember) => ({ ...row, ownerMember })).where(row => row.principal.id === params.principalId).select(row => ({ agent_principal_id: row.agent.principal_id,
      agent_principal_kind: row.agent.principal_kind,
      agent_owner_id: row.agent.owner_id,
      agent_display_name_override: row.agent.display_name_override,
      agent_wake_mode: row.agent.wake_mode,
      principal_id: row.principal.id,
      principal_matrix_user_id: row.principal.matrix_user_id,
      principal_kind: row.principal.kind,
      principal_status: row.principal.status,
      principal_revision: row.principal.revision,
      principal_created_at: row.principal.created_at,
      application_principal_id: row.application.principal_id,
      application_applied_revision: row.application.applied_revision,
      application_applied_intent_hash: row.application.applied_intent_hash,
      application_applied_status: row.application.applied_status,
      application_native_display_name: row.application.native_display_name,
      application_last_attempt_at: row.application.last_attempt_at,
      application_last_success_at: row.application.last_success_at,
      application_next_check_at: row.application.next_check_at,
      application_error_code: row.application.error_code,
      application_error_message: row.application.error_message,
      owner_id: row.owner.id,
      owner_matrix_user_id: row.owner.matrix_user_id,
      owner_kind: row.owner.kind,
      owner_status: row.owner.status,
      owner_revision: row.owner.revision,
      owner_created_at: row.owner.created_at,
      ownerMember_principal_id: row.ownerMember.principal_id,
      ownerMember_principal_kind: row.ownerMember.principal_kind,
      ownerMember_display_name: row.ownerMember.display_name,
      name: row.name.name })).firstOrDefault(), { principalId });
        return success(row ? agentRecord(row) : null);
      });
    },
    agents(filter) { return stored(() => success(filter.ownerId === undefined ? allAgents(database, filter) : ownedAgents(database, filter))); },
    members(filter) {
      return stored(() => {
        const params = { offset: (filter.page - 1) * filter.pageSize, limit: filter.pageSize };
        const rows = executeSelect(database, schema, (query, params) => query.from('member').join(query.from('principal'), member => member.principal_id, principal => principal.id, (member, principal) => ({ member, principal }))
  .join(query.from('principal_role'), row => row.member.principal_id, role => role.principal_id, (row, role) => ({ ...row, role }))
  .join(query.from('principal_application'), row => row.member.principal_id, application => application.principal_id,
    (row, application) => ({ ...row, application })).orderBy(row => row.principal.created_at).thenBy(row => row.principal.id)
          .skip(params.offset).take(params.limit).select(row => ({ member_principal_id: row.member.principal_id,
      member_principal_kind: row.member.principal_kind,
      member_display_name: row.member.display_name,
      principal_id: row.principal.id,
      principal_matrix_user_id: row.principal.matrix_user_id,
      principal_kind: row.principal.kind,
      principal_status: row.principal.status,
      principal_revision: row.principal.revision,
      principal_created_at: row.principal.created_at,
      role_principal_id: row.role.principal_id,
      role_principal_kind: row.role.principal_kind,
      role_role_code: row.role.role_code,
      role_assigned_by_member_id: row.role.assigned_by_member_id,
      role_assigned_at: row.role.assigned_at,
      application_principal_id: row.application.principal_id,
      application_applied_revision: row.application.applied_revision,
      application_applied_intent_hash: row.application.applied_intent_hash,
      application_applied_status: row.application.applied_status,
      application_native_display_name: row.application.native_display_name,
      application_last_attempt_at: row.application.last_attempt_at,
      application_last_success_at: row.application.last_success_at,
      application_next_check_at: row.application.next_check_at,
      application_error_code: row.application.error_code,
      application_error_message: row.application.error_message })), params);
        const total = executeSelect(database, schema, query => query.from('member').count());
        return success(page(rows.map(memberRecord), total, filter));
      });
    },
    permissions(principalId) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('principal_role')
        .join(query.from('role_permission'), assigned => assigned.role_code, permission => permission.role_code, (assigned, permission) => ({ assigned, permission }))
        .where(row => row.assigned.principal_id === params.principalId).orderBy(row => row.permission.permission_code)
        .select(row => ({ code: row.permission.permission_code })), { principalId }).map(row => row.code)));
    },
    activeAdministratorCount() {
      return stored(() => success(executeSelect(database, schema, query => query.from('principal_role')
        .join(query.from('principal'), assigned => assigned.principal_id, principal => principal.id, (assigned, principal) => ({ assigned, principal }))
        .where(row => row.assigned.role_code === 'administrator' && row.principal.status === 'active').count())));
    },
    activeAgentCount(ownerId) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('agent')
                .join(query.from('principal').where(row => row.status !== 'revoked'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
        .join(query.from('fleet_instance'), row => row.agent.principal_id, instance => instance.agent_id, (row, instance) => ({ ...row, instance }))
        .join(query.from('fleet'), row => row.agent.owner_id, fleet => fleet.owner_id, (row, fleet) => ({ ...row, fleet }))
        .where(row => row.instance.retired_at === null && row.fleet.archived_at === null && row.instance.owner_id === row.fleet.owner_id && row.instance.fleet_key === row.fleet.fleet_key && (params.ownerId === null || row.agent.owner_id === params.ownerId)).count(), { ownerId: ownerId ?? null })));
    },
    agentIds(ownerId) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('agent')
        .where(row => row.owner_id === params.ownerId).orderBy(row => row.principal_id).select(row => ({ id: row.principal_id })), { ownerId }).map(row => row.id)));
    },
    activePrincipals() {
      return stored(() => {
        const humans = executeSelect(database, schema, query => query.from('member').join(query.from('principal'), member => member.principal_id, principal => principal.id, (member, principal) => ({ member, principal }))
  .join(query.from('principal_role'), row => row.member.principal_id, role => role.principal_id, (row, role) => ({ ...row, role }))
  .join(query.from('principal_application'), row => row.member.principal_id, application => application.principal_id,
    (row, application) => ({ ...row, application })).where(row => row.principal.status === 'active')
          .select(row => ({ member_principal_id: row.member.principal_id,
      member_principal_kind: row.member.principal_kind,
      member_display_name: row.member.display_name,
      principal_id: row.principal.id,
      principal_matrix_user_id: row.principal.matrix_user_id,
      principal_kind: row.principal.kind,
      principal_status: row.principal.status,
      principal_revision: row.principal.revision,
      principal_created_at: row.principal.created_at,
      role_principal_id: row.role.principal_id,
      role_principal_kind: row.role.principal_kind,
      role_role_code: row.role.role_code,
      role_assigned_by_member_id: row.role.assigned_by_member_id,
      role_assigned_at: row.role.assigned_at,
      application_principal_id: row.application.principal_id,
      application_applied_revision: row.application.applied_revision,
      application_applied_intent_hash: row.application.applied_intent_hash,
      application_applied_status: row.application.applied_status,
      application_native_display_name: row.application.native_display_name,
      application_last_attempt_at: row.application.last_attempt_at,
      application_last_success_at: row.application.last_success_at,
      application_next_check_at: row.application.next_check_at,
      application_error_code: row.application.error_code,
      application_error_message: row.application.error_message })));
        const agents = executeSelect(database, schema, query => query.from('agent')
  .join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
  .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
  .join(query.from('fleet_instance'), row => row.agent.principal_id, instance => instance.agent_id, (row, instance) => ({ ...row, instance }))
  .join(query.from('fleet'), row => row.agent.owner_id, fleet => fleet.owner_id, (row, fleet) => ({ ...row, fleet }))
  .join(query.from('principal_application'), row => row.agent.principal_id, application => application.principal_id,
    (row, application) => ({ ...row, application }))
  .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id,
    (row, owner) => ({ ...row, owner }))
  .join(query.from('member'), row => row.agent.owner_id, ownerMember => ownerMember.principal_id,
    (row, ownerMember) => ({ ...row, ownerMember })).where(row => row.instance.retired_at === null && row.fleet.archived_at === null && row.instance.owner_id === row.fleet.owner_id && row.instance.fleet_key === row.fleet.fleet_key && row.principal.status === 'active' && row.owner.status === 'active')
          .select(row => ({ agent_principal_id: row.agent.principal_id,
      agent_principal_kind: row.agent.principal_kind,
      agent_owner_id: row.agent.owner_id,
      agent_display_name_override: row.agent.display_name_override,
      agent_wake_mode: row.agent.wake_mode,
      principal_id: row.principal.id,
      principal_matrix_user_id: row.principal.matrix_user_id,
      principal_kind: row.principal.kind,
      principal_status: row.principal.status,
      principal_revision: row.principal.revision,
      principal_created_at: row.principal.created_at,
      application_principal_id: row.application.principal_id,
      application_applied_revision: row.application.applied_revision,
      application_applied_intent_hash: row.application.applied_intent_hash,
      application_applied_status: row.application.applied_status,
      application_native_display_name: row.application.native_display_name,
      application_last_attempt_at: row.application.last_attempt_at,
      application_last_success_at: row.application.last_success_at,
      application_next_check_at: row.application.next_check_at,
      application_error_code: row.application.error_code,
      application_error_message: row.application.error_message,
      owner_id: row.owner.id,
      owner_matrix_user_id: row.owner.matrix_user_id,
      owner_kind: row.owner.kind,
      owner_status: row.owner.status,
      owner_revision: row.owner.revision,
      owner_created_at: row.owner.created_at,
      ownerMember_principal_id: row.ownerMember.principal_id,
      ownerMember_principal_kind: row.ownerMember.principal_kind,
      ownerMember_display_name: row.ownerMember.display_name,
      name: row.name.name })));
        return success([
          ...humans.map(memberRecord).map(row => ({ principal: row.principal, displayName: row.member.displayName, ownerId: row.principal.id })),
          ...agents.map(agentRecord).map(row => ({ principal: row.principal, displayName: agentDisplayName(row.name, row.ownerMember.displayName, row.agent.displayNameOverride), ownerId: row.owner.id })),
        ]);
      });
    },
  };
}
