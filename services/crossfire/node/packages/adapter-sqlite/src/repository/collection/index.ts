import { executeSelect, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import { schema } from '../../schema/tables.js';
import { success } from '@ctlflow/crossfire-kernel/result';
import type { CollectionRepository } from '@ctlflow/crossfire-domain/port/collection';
import { stored } from '../stored.js';
import { page } from '../directory/index.js';
import { mapEnrollmentItem } from '../enrollment-item/map.js';
import { mapFleetInstance } from '../fleet-instance/map.js';
import { mapAgentRoomGrant } from '../agent-room-grant/map.js';
import { mapAgentRoomPermission } from '../agent-room-permission/map.js';
import { mapAgentWakeSender } from '../agent-wake-sender/map.js';
import { mapListenerRun } from '../listener-run/map.js';
import { mapWakeNotice } from '../wake-notice/map.js';
import { mapPrincipalApplication } from '../principal-application/map.js';
import { mapRoomGrantApplication } from '../room-grant-application/map.js';
import { mapEnrollmentRequest } from '../enrollment-request/map.js';
import { mapAgentName } from '../agent-name/map.js';
import { mapMemberInvitation } from '../member-invitation/map.js';
import { mapRolePermission } from '../role-permission/map.js';
import { mapFleet } from '../fleet/map.js';
import { mapAuditEvent } from '../audit-event/map.js';

export function createCollectionRepository(database: Database.Database): CollectionRepository {
  return {
    enrollmentMetadata(enrollmentId) { return stored(() => success(executeSelect(database, schema, (query, params) => query.from('enrollment_controller_metadata')
      .where(row => row.enrollment_id === params.enrollmentId).orderBy(row => row.key).select(row => ({ key: row.key, value: row.value })), { enrollmentId }))); },
    fleetMetadata(fleetIds) { return stored(() => success(executeSelect(database, schema, (query, params) => query.from('fleet_controller_metadata')
      .where(row => params.fleetIds.includes(row.fleet_id)).orderBy(row => row.fleet_id).thenBy(row => row.key)
      .select(row => ({ fleetId: row.fleet_id, key: row.key, value: row.value })), { fleetIds }))); },
    enrollmentItems(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('enrollment_item')
        .where(row => row.request_id === params.requestId).orderBy(row => row.instance_key), input).map(mapEnrollmentItem)));
    },
    fleetInstances(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('fleet_instance')
        .where(row => row.owner_id === params.ownerId && row.fleet_key === params.fleetKey && row.retired_at === null).orderBy(row => row.instance_key), input).map(mapFleetInstance)));
    },
    roomGrants(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('agent_room_grant')
        .where(row => row.agent_id === params.agentId).orderBy(row => row.room_id), input).map(mapAgentRoomGrant)));
    },
    roomPermissions(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('agent_room_permission')
        .where(row => row.agent_id === params.agentId && row.room_id === params.roomId).orderBy(row => row.permission_code), input).map(mapAgentRoomPermission)));
    },
    wakeSenders(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('agent_wake_sender')
        .where(row => row.agent_id === params.agentId).orderBy(row => row.sender_principal_id), input).map(mapAgentWakeSender)));
    },
    wakeSendersForAgents(agentIds) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('agent_wake_sender')
        .where(row => params.agentIds.includes(row.agent_id)).orderBy(row => row.agent_id).thenBy(row => row.sender_principal_id),
        { agentIds }).map(mapAgentWakeSender)));
    },
    listenerRuns(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('listener_run')
        .where(row => row.agent_id === params.agentId).orderBy(row => row.id), input).map(mapListenerRun)));
    },
    pendingNotices(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('wake_notice')
        .where(row => row.status === 'pending' && row.next_attempt_at !== null && row.next_attempt_at <= params.now).orderBy(row => row.next_attempt_at), input).map(mapWakeNotice)));
    },
    noticeHistory(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('wake_notice')
        .where(row => row.receiver_agent_id === params.receiverAgentId && row.sender_backend_user_id === params.senderBackendUserId && (row.status === 'pending' || row.reserved_at > params.since)).orderBy(row => row.reserved_at), input).map(mapWakeNotice)));
    },
    duePrincipals(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('principal_application')
        .where(row => row.next_check_at <= params.now).orderBy(row => row.next_check_at), input).map(mapPrincipalApplication)));
    },
    dueRoomGrants(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('room_grant_application')
        .where(row => row.next_check_at <= params.now).orderBy(row => row.next_check_at), input).map(mapRoomGrantApplication)));
    },
    agentRoomApplications(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('room_grant_application')
        .where(row => row.agent_id === params.agentId).orderBy(row => row.room_id), input).map(mapRoomGrantApplication)));
    },
    expiredEnrollments(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('enrollment_request')
        .where(row => row.status === 'pending' && row.expires_at <= params.now).orderBy(row => row.expires_at), input).map(mapEnrollmentRequest)));
    },
    agentNamesByRequest(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('agent_name')
        .where(row => row.request_id === params.requestId).orderBy(row => row.name), input).map(mapAgentName)));
    },
    claimedInvitations(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('member_invitation')
        .where(row => row.consumed_by_member_id === null && row.claim_backend_user_id !== null && (row.revoked_at !== null || row.expires_at <= params.now)).orderBy(row => row.expires_at), input).map(mapMemberInvitation)));
    },
    rolePermissions(input) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('role_permission')
        .where(row => row.role_code === params.roleCode).orderBy(row => row.permission_code), input).map(mapRolePermission)));
    },
    enrollments(input) {
      return stored(() => {
        const params = { offset: (input.page - 1) * input.pageSize, limit: input.pageSize, ownerId: input.ownerId ?? '' };
        if (input.ownerId !== undefined) {
          const total = executeSelect(database, schema, (query, params) => query.from('enrollment_request').where(row => row.owner_id === params.ownerId).count(), params);
          const rows = executeSelect(database, schema, (query, params) => query.from('enrollment_request').where(row => row.owner_id === params.ownerId).orderByDescending(row => row.created_at).thenBy(row => row.id).skip(params.offset).take(params.limit), params);
          return success(page(rows.map(mapEnrollmentRequest), total, input));
        }
        const total = executeSelect(database, schema, query => query.from('enrollment_request').count());
        const rows = executeSelect(database, schema, (query, params) => query.from('enrollment_request').orderByDescending(row => row.created_at).thenBy(row => row.id).skip(params.offset).take(params.limit), params);
        return success(page(rows.map(mapEnrollmentRequest), total, input));
      });
    },
    fleets(input) {
      return stored(() => {
        const params = { offset: (input.page - 1) * input.pageSize, limit: input.pageSize, ownerId: input.ownerId ?? '', search: input.search ?? '' };
        if (input.ownerId !== undefined) {
          const total = executeSelect(database, schema, (query, params) => query.from('fleet').where(row => row.archived_at === null && row.owner_id === params.ownerId
            && (row.label.includes(params.search) || row.fleet_key.includes(params.search) || row.controller_name.includes(params.search))).count(), params);
          const rows = executeSelect(database, schema, (query, params) => query.from('fleet').where(row => row.archived_at === null && row.owner_id === params.ownerId
            && (row.label.includes(params.search) || row.fleet_key.includes(params.search) || row.controller_name.includes(params.search)))
            .orderByDescending(row => row.created_at).thenBy(row => row.id).skip(params.offset).take(params.limit), params);
          return success(page(rows.map(mapFleet), total, input));
        }
        const total = executeSelect(database, schema, (query, params) => query.from('fleet').where(row => row.archived_at === null && (row.label.includes(params.search)
          || row.fleet_key.includes(params.search) || row.controller_name.includes(params.search))).count(), params);
        const rows = executeSelect(database, schema, (query, params) => query.from('fleet').where(row => row.archived_at === null && (row.label.includes(params.search)
          || row.fleet_key.includes(params.search) || row.controller_name.includes(params.search)))
          .orderByDescending(row => row.created_at).thenBy(row => row.id).skip(params.offset).take(params.limit), params);
        return success(page(rows.map(mapFleet), total, input));
      });
    },
    invitations(input) {
      return stored(() => {
        const params = { offset: (input.page - 1) * input.pageSize, limit: input.pageSize };
        if (input.createdByMemberId !== undefined) {
          const scoped = { ...params, createdByMemberId: input.createdByMemberId };
          const total = executeSelect(database, schema, (query, params) => query.from('member_invitation').where(row => row.created_by_member_id === params.createdByMemberId).count(), scoped);
          const rows = executeSelect(database, schema, (query, params) => query.from('member_invitation').where(row => row.created_by_member_id === params.createdByMemberId).orderByDescending(row => row.created_at).thenBy(row => row.id).skip(params.offset).take(params.limit), scoped);
          return success(page(rows.map(mapMemberInvitation), total, input));
        }
        const total = executeSelect(database, schema, query => query.from('member_invitation').count());
        const rows = executeSelect(database, schema, (query, params) => query.from('member_invitation').orderByDescending(row => row.created_at).thenBy(row => row.id).skip(params.offset).take(params.limit), params);
        return success(page(rows.map(mapMemberInvitation), total, input));
      });
    },
    audits(input) {
      return stored(() => {
        const params = { offset: (input.page - 1) * input.pageSize, limit: input.pageSize, ownerId: input.ownerId ?? '' };
        if (input.ownerId !== undefined) {
          const total = executeSelect(database, schema, (query, params) => query.from('audit_event').where(row => row.owner_id === params.ownerId).count(), params);
          const rows = executeSelect(database, schema, (query, params) => query.from('audit_event').where(row => row.owner_id === params.ownerId).orderByDescending(row => row.created_at).thenByDescending(row => row.id).skip(params.offset).take(params.limit), params);
          return success(page(rows.map(mapAuditEvent), total, input));
        }
        const total = executeSelect(database, schema, query => query.from('audit_event').count());
        const rows = executeSelect(database, schema, (query, params) => query.from('audit_event').orderByDescending(row => row.created_at).thenByDescending(row => row.id).skip(params.offset).take(params.limit), params);
        return success(page(rows.map(mapAuditEvent), total, input));
      });
    },

    pendingEnrollmentCount(ownerId) {
      return stored(() => success(ownerId === undefined
        ? executeSelect(database, schema, query => query.from('enrollment_request').where(row => row.status === 'pending').count())
        : executeSelect(database, schema, (query, params) => query.from('enrollment_request').where(row => row.status === 'pending' && row.owner_id === params.ownerId).count(), { ownerId })));
    },
    pendingIdentityCount(ownerId) {
      return stored(() => success(ownerId === undefined
        ? executeSelect(database, schema, query => query.from('enrollment_request').join(query.from('enrollment_item'), request => request.id, item => item.request_id,
          (request, item) => ({ request, item })).where(row => row.request.status === 'pending' && row.item.outcome === 'claimed' && row.item.agent_id === null).count())
        : executeSelect(database, schema, (query, params) => query.from('enrollment_request').join(query.from('enrollment_item'), request => request.id, item => item.request_id,
          (request, item) => ({ request, item })).where(row => row.request.status === 'pending' && row.request.owner_id === params.ownerId && row.item.outcome === 'claimed' && row.item.agent_id === null).count(), { ownerId })));
    },
    memberSessionCount(memberId, now) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('member_session')
        .where(row => row.member_id === params.memberId && row.expires_at > params.now).count(), { memberId, now })));
    },
    removeExpiredSessions(now) {
      return stored(() => { executeDelete(database, schema, (query, params) => query.deleteFrom('member_session')
        .where(row => row.expires_at <= params.now), { now }); return success(undefined); });
    },
    invitationByClaim(backendUserId) {
      return stored(() => {
        const row = executeSelect(database, schema, (query, params) => query.from('member_invitation')
          .where(row => row.claim_backend_user_id === params.backendUserId).firstOrDefault(), { backendUserId });
        return success(row ? mapMemberInvitation(row) : null);
      });
    },
  };
}
