import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { Principal, Member, Agent, AgentCredential, PrincipalApplication } from '../identity/types.js';
import type { Permission, Role, RolePermission, PrincipalRole } from '../authorization/types.js';
import type { FleetControllerMetadata, EnrollmentControllerMetadata, FleetCredential, EnrollmentRequest, EnrollmentItem, AgentName, Fleet, FleetInstance } from '../enrollment/types.js';
import type { AgentRoomGrant, AgentRoomPermission, RoomGrantApplication, AgentWakeSender } from '../room-access/types.js';
import type { MemberInvitation, MemberSession, ListenerRun, WakeNotice } from '../activity/types.js';
import type { InstancePolicy, AuditEvent } from '../audit/types.js';
import type { OwnerConversationRepository } from '../owner-conversation/types.js';
import type { FleetPolicyRepository } from './fleet-policy.js';

export type PrincipalKey = { id: string };
export type PrincipalRepository = {
  find(key: PrincipalKey): Result<Principal | null>;
  insert(value: Principal): Result<void>;
  update(value: Principal): Result<void>;
};

export type MemberKey = { principalId: string };
export type MemberRepository = {
  find(key: MemberKey): Result<Member | null>;
  insert(value: Member): Result<void>;
  update(value: Member): Result<void>;
};

export type AgentKey = { principalId: string };
export type AgentRepository = {
  find(key: AgentKey): Result<Agent | null>;
  insert(value: Agent): Result<void>;
  update(value: Agent): Result<void>;
};

export type AgentCredentialKey = { agentId: string };
export type AgentCredentialRepository = {
  find(key: AgentCredentialKey): Result<AgentCredential | null>;
  insert(value: AgentCredential): Result<void>;
  update(value: AgentCredential): Result<void>;
};

export type PrincipalApplicationKey = { principalId: string };
export type PrincipalApplicationRepository = {
  find(key: PrincipalApplicationKey): Result<PrincipalApplication | null>;
  insert(value: PrincipalApplication): Result<void>;
  update(value: PrincipalApplication): Result<void>;
};

export type PermissionKey = { code: string };
export type PermissionRepository = {
  find(key: PermissionKey): Result<Permission | null>;
  insert(value: Permission): Result<void>;
};

export type RoleKey = { code: 'member' | 'administrator' | 'agent' };
export type RoleRepository = {
  find(key: RoleKey): Result<Role | null>;
  insert(value: Role): Result<void>;
};

export type RolePermissionKey = { roleCode: string; permissionCode: string };
export type RolePermissionRepository = {
  find(key: RolePermissionKey): Result<RolePermission | null>;
  insert(value: RolePermission): Result<void>;
};

export type PrincipalRoleKey = { principalId: string };
export type PrincipalRoleRepository = {
  find(key: PrincipalRoleKey): Result<PrincipalRole | null>;
  insert(value: PrincipalRole): Result<void>;
  update(value: PrincipalRole): Result<void>;
};

export type EnrollmentRequestKey = { id: string };
export type EnrollmentRequestRepository = {
  find(key: EnrollmentRequestKey): Result<EnrollmentRequest | null>;
  insert(value: EnrollmentRequest): Result<void>;
  update(value: EnrollmentRequest): Result<void>;
};

export type EnrollmentItemKey = { requestId: string; instanceKey: string };
export type EnrollmentItemRepository = {
  find(key: EnrollmentItemKey): Result<EnrollmentItem | null>;
  insert(value: EnrollmentItem): Result<void>;
  update(value: EnrollmentItem): Result<void>;
};

export type AgentNameKey = { name: string };
export type AgentNameRepository = {
  find(key: AgentNameKey): Result<AgentName | null>;
  insert(value: AgentName): Result<void>;
  update(value: AgentName): Result<void>;
  remove(key: AgentNameKey): Result<void>;
};

export type FleetKey = { ownerId: string; fleetKey: string };
export type FleetRepository = {
  findById(id: string): Result<Fleet | null>;
  remove(key: FleetKey): Result<void>;
  find(key: FleetKey): Result<Fleet | null>;
  insert(value: Fleet): Result<void>;
  update(value: Fleet): Result<void>;
};

export type FleetInstanceKey = { ownerId: string; fleetKey: string; instanceKey: string };
export type FleetInstanceRepository = {
  remove(key: FleetInstanceKey): Result<void>;
  find(key: FleetInstanceKey): Result<FleetInstance | null>;
  insert(value: FleetInstance): Result<void>;
  update(value: FleetInstance): Result<void>;
};

export type AgentRoomGrantKey = { agentId: string; roomId: string };
export type AgentRoomGrantRepository = {
  find(key: AgentRoomGrantKey): Result<AgentRoomGrant | null>;
  insert(value: AgentRoomGrant): Result<void>;
  update(value: AgentRoomGrant): Result<void>;
};

export type AgentRoomPermissionKey = { agentId: string; roomId: string; permissionCode: string };
export type AgentRoomPermissionRepository = {
  find(key: AgentRoomPermissionKey): Result<AgentRoomPermission | null>;
  insert(value: AgentRoomPermission): Result<void>;
  update(value: AgentRoomPermission): Result<void>;
  remove(key: AgentRoomPermissionKey): Result<void>;
};

export type RoomGrantApplicationKey = { agentId: string; roomId: string };
export type RoomGrantApplicationRepository = {
  find(key: RoomGrantApplicationKey): Result<RoomGrantApplication | null>;
  insert(value: RoomGrantApplication): Result<void>;
  update(value: RoomGrantApplication): Result<void>;
};

export type AgentWakeSenderKey = { agentId: string; senderPrincipalId: string };
export type AgentWakeSenderRepository = {
  find(key: AgentWakeSenderKey): Result<AgentWakeSender | null>;
  insert(value: AgentWakeSender): Result<void>;
  update(value: AgentWakeSender): Result<void>;
  remove(key: AgentWakeSenderKey): Result<void>;
};

export type MemberInvitationKey = { id: string };
export type MemberInvitationRepository = {
  find(key: MemberInvitationKey): Result<MemberInvitation | null>;
  insert(value: MemberInvitation): Result<void>;
  update(value: MemberInvitation): Result<void>;
};

export type MemberSessionKey = { secretHash: string };
export type MemberSessionRepository = {
  find(key: MemberSessionKey): Result<MemberSession | null>;
  insert(value: MemberSession): Result<void>;
  update(value: MemberSession): Result<void>;
  remove(key: MemberSessionKey): Result<void>;
};

export type ListenerRunKey = { id: string };
export type ListenerRunRepository = {
  find(key: ListenerRunKey): Result<ListenerRun | null>;
  insert(value: ListenerRun): Result<void>;
  update(value: ListenerRun): Result<void>;
};

export type WakeNoticeKey = { receiverAgentId: string; eventId: string };
export type WakeNoticeRepository = {
  find(key: WakeNoticeKey): Result<WakeNotice | null>;
  insert(value: WakeNotice): Result<void>;
  update(value: WakeNotice): Result<void>;
};

export type InstancePolicyKey = { id: 'instance' };
export type InstancePolicyRepository = {
  find(key: InstancePolicyKey): Result<InstancePolicy | null>;
  insert(value: InstancePolicy): Result<void>;
  update(value: InstancePolicy): Result<void>;
};

export type AuditEventKey = { id: string };
export type AuditEventRepository = {
  find(key: AuditEventKey): Result<AuditEvent | null>;
  insert(value: AuditEvent): Result<void>;
};

export type FleetCredentialRepository = {
  find(key: { id: string }): Result<FleetCredential | null>;
  insert(value: FleetCredential): Result<void>;
  update(value: FleetCredential): Result<void>;
  remove(key: { id: string }): Result<void>;
};

export type FleetControllerMetadataRepository = {
  find(key: { fleetId: string; key: string }): Result<FleetControllerMetadata | null>;
  insert(value: FleetControllerMetadata): Result<void>;
  update(value: FleetControllerMetadata): Result<void>;
  remove(key: { fleetId: string; key: string }): Result<void>;
};

export type EnrollmentControllerMetadataRepository = {
  find(key: { enrollmentId: string; key: string }): Result<EnrollmentControllerMetadata | null>;
  insert(value: EnrollmentControllerMetadata): Result<void>;
  update(value: EnrollmentControllerMetadata): Result<void>;
  remove(key: { enrollmentId: string; key: string }): Result<void>;
};

export type Repositories = {
  fleetRuntimeOperation: import('../fleet/runtime-types.js').RuntimeOperationRepository;
  fleetPolicy: FleetPolicyRepository;
  ownerConversation: OwnerConversationRepository;
  wakeRule: WakeRuleRepository;
  wakeRuleAgent: WakeRuleAgentRepository;
  wakeDelivery: WakeDeliveryRepository;
  fleetConnection: FleetConnectionRepository;
  fleetMessage: FleetMessageRepository;
  fleetMessageDelivery: FleetMessageDeliveryRepository;
  enrollmentControllerMetadata: EnrollmentControllerMetadataRepository;
  fleetControllerMetadata: FleetControllerMetadataRepository;
  fleetCredential: FleetCredentialRepository;
  principal: PrincipalRepository;
  member: MemberRepository;
  agent: AgentRepository;
  agentCredential: AgentCredentialRepository;
  principalApplication: PrincipalApplicationRepository;
  permission: PermissionRepository;
  role: RoleRepository;
  rolePermission: RolePermissionRepository;
  principalRole: PrincipalRoleRepository;
  enrollmentRequest: EnrollmentRequestRepository;
  enrollmentItem: EnrollmentItemRepository;
  agentName: AgentNameRepository;
  fleet: FleetRepository;
  fleetInstance: FleetInstanceRepository;
  agentRoomGrant: AgentRoomGrantRepository;
  agentRoomPermission: AgentRoomPermissionRepository;
  roomGrantApplication: RoomGrantApplicationRepository;
  agentWakeSender: AgentWakeSenderRepository;
  memberInvitation: MemberInvitationRepository;
  memberSession: MemberSessionRepository;
  listenerRun: ListenerRunRepository;
  wakeNotice: WakeNoticeRepository;
  instancePolicy: InstancePolicyRepository;
  auditEvent: AuditEventRepository;
};
import type { FleetConnectionRepository, FleetMessageRepository, FleetMessageDeliveryRepository } from '../fleet/control-types.js';
import type { WakeRuleRepository, WakeRuleAgentRepository, WakeDeliveryRepository } from '../wake-up/types.js';
