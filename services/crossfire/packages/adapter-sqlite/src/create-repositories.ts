import { createEnrollmentControllerMetadataRepository } from './repository/enrollment-controller-metadata/index.js';
import { createFleetControllerMetadataRepository } from './repository/fleet-controller-metadata/index.js';
import { createFleetCredentialRepository } from './repository/fleet-credential/index.js';
import type Database from 'better-sqlite3';
import type { Repositories } from '@crossfire/domain/port/repositories';
import { createPrincipalRepository } from './repository/principal/index.js';
import { createMemberRepository } from './repository/member/index.js';
import { createAgentRepository } from './repository/agent/index.js';
import { createAgentCredentialRepository } from './repository/agent-credential/index.js';
import { createPrincipalApplicationRepository } from './repository/principal-application/index.js';
import { createPermissionRepository } from './repository/permission/index.js';
import { createRoleRepository } from './repository/role/index.js';
import { createRolePermissionRepository } from './repository/role-permission/index.js';
import { createPrincipalRoleRepository } from './repository/principal-role/index.js';
import { createEnrollmentRequestRepository } from './repository/enrollment-request/index.js';
import { createEnrollmentItemRepository } from './repository/enrollment-item/index.js';
import { createAgentNameRepository } from './repository/agent-name/index.js';
import { createFleetRepository } from './repository/fleet/index.js';
import { createFleetInstanceRepository } from './repository/fleet-instance/index.js';
import { createAgentRoomGrantRepository } from './repository/agent-room-grant/index.js';
import { createAgentRoomPermissionRepository } from './repository/agent-room-permission/index.js';
import { createRoomGrantApplicationRepository } from './repository/room-grant-application/index.js';
import { createAgentWakeSenderRepository } from './repository/agent-wake-sender/index.js';
import { createMemberInvitationRepository } from './repository/member-invitation/index.js';
import { createMemberSessionRepository } from './repository/member-session/index.js';
import { createListenerRunRepository } from './repository/listener-run/index.js';
import { createWakeNoticeRepository } from './repository/wake-notice/index.js';
import { createInstancePolicyRepository } from './repository/instance-policy/index.js';
import { createAuditEventRepository } from './repository/audit-event/index.js';
import { createWakeRuleRepository } from './repository/wake-rule/index.js';
import { createWakeRuleAgentRepository } from './repository/wake-rule-agent/index.js';
import { createWakeDeliveryRepository } from './repository/wake-delivery/index.js';
import { createOwnerConversationRepository } from './repository/owner-conversation/index.js';
import { createFleetPolicyRepository } from './repository/fleet-policy/index.js';

export function createRepositories(database: Database.Database): Repositories {
  return {
    fleetPolicy: createFleetPolicyRepository(database),
    ownerConversation: createOwnerConversationRepository(database),
    wakeRule: createWakeRuleRepository(database),
    wakeRuleAgent: createWakeRuleAgentRepository(database),
    wakeDelivery: createWakeDeliveryRepository(database),
    fleetConnection: createFleetConnectionRepository(database),
    fleetMessage: createFleetMessageRepository(database),
    fleetMessageDelivery: createFleetMessageDeliveryRepository(database),
    enrollmentControllerMetadata: createEnrollmentControllerMetadataRepository(database),
    fleetControllerMetadata: createFleetControllerMetadataRepository(database),
    fleetCredential: createFleetCredentialRepository(database),
    principal: createPrincipalRepository(database),
    member: createMemberRepository(database),
    agent: createAgentRepository(database),
    agentCredential: createAgentCredentialRepository(database),
    principalApplication: createPrincipalApplicationRepository(database),
    permission: createPermissionRepository(database),
    role: createRoleRepository(database),
    rolePermission: createRolePermissionRepository(database),
    principalRole: createPrincipalRoleRepository(database),
    enrollmentRequest: createEnrollmentRequestRepository(database),
    enrollmentItem: createEnrollmentItemRepository(database),
    agentName: createAgentNameRepository(database),
    fleet: createFleetRepository(database),
    fleetInstance: createFleetInstanceRepository(database),
    agentRoomGrant: createAgentRoomGrantRepository(database),
    agentRoomPermission: createAgentRoomPermissionRepository(database),
    roomGrantApplication: createRoomGrantApplicationRepository(database),
    agentWakeSender: createAgentWakeSenderRepository(database),
    memberInvitation: createMemberInvitationRepository(database),
    memberSession: createMemberSessionRepository(database),
    listenerRun: createListenerRunRepository(database),
    wakeNotice: createWakeNoticeRepository(database),
    instancePolicy: createInstancePolicyRepository(database),
    auditEvent: createAuditEventRepository(database),
  };
}
import { createFleetConnectionRepository } from './repository/fleet-connection/index.js';
import { createFleetMessageRepository } from './repository/fleet-message/index.js';
import { createFleetMessageDeliveryRepository } from './repository/fleet-message-delivery/index.js';
