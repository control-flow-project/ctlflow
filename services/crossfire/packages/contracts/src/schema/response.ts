import { controller } from './controller.js';
import { HUMAN_SIGNUP } from '../policy.js';
import * as check from './validation.js';
import type { Parsed } from './validation.js';
import { fleetControl } from '../fleet-control.js';
import { coordinationPolicy } from '../coordination-policy.js';
import { nativeRuntimeSummary } from '../runtime.js';
import { backendConfiguration } from '../client.js';
const backendLink = check.refine(check.text(2048), value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && value === value.trim() && !/[\u0000-\u0020\u007f]/u.test(value); }
  catch { return false; }
}, 'Expected an absolute HTTP(S) backend link without credentials');
export const messagingBackend = check.object({ type: check.name, label: check.text(100), chatUrl: backendLink, signupUrl: backendLink,
  signupInstructions: check.list(check.text(2000), 20), configuration: backendConfiguration });
export const principal = check.object({ principalId: check.identifier, backendUserId: check.backendUserId, kind: check.choice('human', 'agent'),
  displayName: check.text(255), ownerId: check.identifier, ownerBackendUserId: check.backendUserId });
export const principalIdentity = check.refine(check.object({ backendUserId: check.backendUserId, kind: check.choice('human', 'agent', 'unknown'),
  ownerBackendUserId: check.nullable(check.backendUserId), displayName: check.nullable(check.text(255)), ownerDisplayName: check.nullable(check.text(255)) }), identity => (identity.kind === 'agent') === (identity.ownerBackendUserId !== null),
  'Only registered agents have an owner');
export const principalIdentities = check.refine(check.list(principalIdentity, 100, 1),
  identities => new Set(identities.map(identity => identity.backendUserId)).size === identities.length, 'Resolved identities must be unique');
export const role = check.object({ code: check.text(100), principalKind: check.choice('human', 'agent'), label: check.text(100) });
export const permission = check.object({ code: check.text(100), grantScope: check.choice('role', 'agent_room'), description: check.text(300) });
export const application = check.object({ appliedRevision: check.nullable(check.integer()), appliedStatus: check.nullable(check.status),
  nativeDisplayName: check.nullable(check.text(255)), lastAttemptAt: check.nullable(check.integer()), lastSuccessAt: check.nullable(check.integer()),
  errorCode: check.nullable(check.text(100)), errorMessage: check.nullable(check.text(4096)) });
export const member = check.object({ memberId: check.identifier, backendUserId: check.backendUserId, displayName: check.text(HUMAN_SIGNUP.labelMax),
  roleCode: check.choice('member', 'administrator'), status: check.status, revision: check.integer(), createdAt: check.integer(), application });
export const session = check.object({ member, csrfSecret: check.secret, permissions: check.list(check.text(100), 100) });
export const listenerRun = check.object({ runId: check.identifier, agentId: check.identifier, release: check.text(200),
  controller: check.object({ fleetId: check.identifier, connectionId: check.identifier, credentialId: check.identifier }),
  startedAt: check.integer(), lastSeenAt: check.integer(), activeMs: check.integer(), messagesDelivered: check.integer(),
  stoppedAt: check.nullable(check.integer()), disconnectRequestedAt: check.nullable(check.integer()) });
export const activity = check.object({ status: check.choice('online', 'offline', 'disconnecting'), activeMs: check.integer(),
  messagesDelivered: check.integer(), lastSeenAt: check.nullable(check.integer()), activeRuns: check.list(listenerRun, 100) });
export const owner = check.object({ memberId: check.identifier, backendUserId: check.backendUserId, displayName: check.text(HUMAN_SIGNUP.labelMax), status: check.status });
export const agent = check.object({ agentId: check.identifier, backendUserId: check.backendUserId, name: check.name, displayName: check.text(255),
  owner, status: check.status, revision: check.integer(), createdAt: check.integer(), application, activity, nativeRuntime: check.nullable(nativeRuntimeSummary),
  deployment: check.object({ fleetId: check.identifier, fleetKey: check.name, label: check.text(100), controllerName: check.text(100), reportedAt: check.integer(), instanceKey: check.name }),
  canRetire: check.boolean, allowedActions: check.list(check.choice('configure', 'room-grant.manage', 'retire'), 3) });
export const wakeSender = check.refine(check.object({ identity: principal, includeAgents: check.boolean }),
  sender => !sender.includeAgents || sender.identity.kind === 'human', 'Only people can include their agents');
export const wakePolicy = check.refine(check.object({ agentId: check.identifier, revision: check.integer(), mode: check.wakeMode, senders: check.list(wakeSender, 2000) }),
  policy => new Set(policy.senders.map(sender => sender.identity.principalId)).size === policy.senders.length
    && policy.senders.every(sender => sender.identity.principalId !== policy.agentId)
    && (policy.mode !== 'everyone' || policy.senders.length === 0), 'Invalid selected wake authority');
export const grant = check.object({ agentId: check.identifier, roomId: check.roomId, generation: check.identifier, authorizerId: check.identifier,
  addedById: check.identifier, accessMode: check.choice('none', 'read', 'reply', 'custom'), nativeAccess: check.nullable(check.backendParameters),
  muted: check.boolean, revision: check.integer(), accessRevision: check.integer(), updatedAt: check.integer() });
export const grantApplication = check.object({ observedGeneration: check.nullable(check.identifier), appliedRevision: check.nullable(check.integer()),
  appliedAccessRevision: check.nullable(check.integer()), membership: check.nullable(check.choice('join', 'invite', 'leave', 'ban')),
  nativeAccess: check.nullable(check.backendParameters), lastAttemptAt: check.nullable(check.integer()), lastSuccessAt: check.nullable(check.integer()),
  errorCode: check.nullable(check.text(100)), errorMessage: check.nullable(check.text(4096)) });
export const grantView = check.object({ agentId: check.identifier, revision: check.integer(), grant: check.nullable(grant),
  ownerConversation: check.boolean,
  application: check.nullable(grantApplication), permissions: check.list(check.choice('room.agent.invite'), 1),
  allowedActions: check.list(check.choice('set', 'remove', 'permissions.set'), 3) });
export const deliveryGrant = check.object({ roomId: check.roomId, accessMode: check.choice('read', 'reply', 'custom'),
  nativeAccess: check.nullable(check.backendParameters), muted: check.boolean });
export const deliveryPolicy = check.refine(check.object({ agentId: check.identifier, backendUserId: check.backendUserId, ownerBackendUserId: check.backendUserId,
  maxMessageBytes: check.integer(4096, 4194304),
  fleetIdleTimeoutSeconds: check.integer(0, 604800),
  status: check.status, ownerStatus: check.status, ownerConversation: check.nullable(check.roomId), roomGrants: check.list(deliveryGrant, 101), wakeMode: check.wakeMode,
  senderBackendUserIds: check.list(check.backendUserId, 2000) }), policy =>
  new Set(policy.senderBackendUserIds).size === policy.senderBackendUserIds.length && !policy.senderBackendUserIds.includes(policy.backendUserId)
  && new Set(policy.roomGrants.map(grant => grant.roomId)).size === policy.roomGrants.length
  && policy.roomGrants.every(grant => (grant.accessMode === 'custom') === (grant.nativeAccess !== null))
  && (policy.ownerConversation === null || policy.roomGrants.some(grant => grant.roomId === policy.ownerConversation && grant.accessMode === 'reply' && !grant.muted))
  && (policy.status === 'active' && policy.ownerStatus === 'active' || policy.senderBackendUserIds.length === 0), 'Invalid resolved delivery authority');
export const roomAuthority = check.object({ backendUserId: check.backendUserId, canInvite: check.boolean, authorityRevision: check.text(255),
  accessModes: check.list(check.choice('read', 'reply', 'custom'), 3),
  accessFields: check.list(check.object({ key: check.text(100), label: check.text(255), minimum: check.integer(Number.MIN_SAFE_INTEGER), maximum: check.integer(Number.MIN_SAFE_INTEGER), defaultValue: check.integer(Number.MIN_SAFE_INTEGER) }), 64),
  permissions: check.list(check.object({ action: check.text(255), label: check.text(1000), allowed: check.boolean }), 1000) });
export const room = check.object({ roomId: check.roomId, name: check.text(255), topic: check.text(4096, 0), alias: check.nullable(check.text(255)),
  authority: check.nullable(roomAuthority) });
export const enrollmentItem = check.object({ instanceKey: check.name, requestedName: check.name, currentName: check.nullable(check.name), outcome: check.choice('claimed', 'existing'),
  agentId: check.nullable(check.identifier), coordinationPolicy });
export const enrollment = check.object({ owner: principal, controllerName: check.text(100), enrollmentId: check.identifier, ownerId: check.identifier, fleetKey: check.name,
  verificationCode: check.text(12, 12), status: check.choice('pending', 'approved', 'rejected', 'expired'), revision: check.integer(),
  createdAt: check.integer(), expiresAt: check.integer(), decidedByMemberId: check.nullable(check.identifier), decidedAt: check.nullable(check.integer()) });
export const enrollmentDetails = check.object({ enrollment, instances: check.list(enrollmentItem, 100) });
export const enrollmentIntroduction = check.object({ enrollment: enrollmentDetails, approvalUrl: check.text(2048) });
export const enrollmentDecision = check.object({ enrollmentId: check.identifier, status: check.choice('approved', 'rejected'), revision: check.integer() });
export const preflight = check.object({ available: check.boolean, instances: check.integer(1, 100) });
export const enrollmentExchange = check.object({ status: check.choice('pending', 'rejected', 'expired', 'provisioning', 'ready'),
  fleet: check.nullable(check.object({ fleetId: check.identifier, controllerCredential: check.nullable(check.text(200)) })),
  ownerBackendUserId: check.backendUserId, instances: check.list(check.object({ instanceKey: check.name, name: check.name, agentId: check.nullable(check.identifier),
    status: check.choice('ready', 'provisioning'), errorCode: check.nullable(check.text(100)), account: check.nullable(check.object({
      userId: check.backendUserId, accessToken: check.text(8192), native: check.backendParameters })) }), 100) });
export const fleet = check.object({ fleetId: check.identifier, owner: principal, fleetKey: check.name, label: check.text(100), controller,
  revision: check.integer(), createdAt: check.integer(), updatedAt: check.integer(), delivery: fleetControl,
  canArchive: check.boolean, allowedActions: check.list(check.choice('configure', 'archive'), 2) });
export const fleetAgent = check.object({ instanceKey: check.name, agent });
export const invitation = check.object({ invitationId: check.identifier, createdByMemberId: check.identifier, roleCode: check.choice('member', 'administrator'),
  createdAt: check.integer(), expiresAt: check.integer(), consumedByMemberId: check.nullable(check.identifier), revokedAt: check.nullable(check.integer()) });
export const invitationCreated = check.object({ invitationId: check.identifier, claimSecret: check.secret, expiresAt: check.integer(), signupUrl: check.text(2048) });
export const policy = check.object({ revision: check.integer(), maxOwnerAgents: check.integer(1, 100), maxAgents: check.integer(1, 1000),
  maxMessageBytes: check.integer(4096, 4194304),
  fleetIdleTimeoutSeconds: check.integer(0, 604800),
  maxPending: check.integer(1, 1000), enrollmentSeconds: check.integer(60, 3600), reconcileSeconds: check.integer(30, 3600), agentInstructions: check.multiline,
  signupMode: check.choice('invitation', 'open'), invitationIssuers: check.choice('administrators', 'members') });
export const audit = check.object({ auditId: check.identifier, requestId: check.text(255), actorCredentialId: check.nullable(check.identifier), actorKind: check.choice('human', 'agent', 'controller', 'system', 'anonymous'),
  actor: check.nullable(principal), target: check.nullable(principal),
  actorPrincipalId: check.nullable(check.identifier), ownerId: check.nullable(check.identifier), targetKind: check.text(100), targetId: check.text(255),
  roomId: check.nullable(check.roomId), membershipGeneration: check.nullable(check.identifier), authorizerId: check.nullable(check.identifier),
  addedById: check.nullable(check.identifier), permissionCode: check.nullable(check.text(100)), action: check.text(100),
  outcome: check.text(100), message: check.text(4096, 0), createdAt: check.integer() });
export const acknowledged = check.object({ accepted: check.boolean });
export const recorded = check.object({ recorded: check.boolean });
export const report = check.object({ disconnect: check.boolean, currentRelease: check.text(200), statisticsAccepted: check.boolean });
export const notice = check.object({ outcome: check.choice('pending', 'sent', 'denied', 'not-applicable', 'not-permitted', 'rate-limited') });
export type AgentView = Parsed<typeof agent>;
export type PrincipalIdentity = Parsed<typeof principalIdentity>;
export type MemberView = Parsed<typeof member>;
export type SessionView = Parsed<typeof session>;
export type RoomView = Parsed<typeof room>;
export type RoomGrantView = Parsed<typeof grantView>;
export type EnrollmentView = Parsed<typeof enrollmentDetails>;
export type FleetView = Parsed<typeof fleet>;
export type DeliveryPolicy = Parsed<typeof deliveryPolicy>;
export type ActivityView = Parsed<typeof activity>;
export type ListenerRunView = Parsed<typeof listenerRun>;
export type PolicyView = Parsed<typeof policy>;
