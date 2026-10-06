import { controller } from './controller.js';
import * as check from './validation.js';
import type { Parser } from './validation.js';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { HUMAN_SIGNUP } from '../policy.js';
import { statisticsBatch } from '../statistics.js';
import { coordinationPolicy } from '../coordination-policy.js';
const revision = check.integer();
const accountProof = check.object({ agentId: check.identifier, accessToken: check.text(8192) });
const instance = check.object({ instanceKey: check.name, name: check.name, identity: check.optional(accountProof), coordinationPolicy });
const roster = { controller, controllerCredential: check.optional(check.text(200)), ownerMatrixId: check.matrixUserId, fleetKey: check.name, instances: check.list(instance, 100, 1) };
export const preflight = check.object(roster);
export const enrollment = check.object({ ...roster, enrollmentId: check.identifier, claimSecret: check.secret });
export const enrollmentDecision = check.object({ expectedRevision: revision, decision: check.choice('approve', 'reject'), verificationCode: check.text(12, 12) });
export const exchange = check.object({ claimSecret: check.secret });
export const session = check.object({ nativeAccessToken: check.text(8192) });
export const agentChange = check.object({ expectedRevision: revision, status: check.optional(check.status), displayName: check.optional(check.nullable(check.text(200))) });
export const wakePolicy = check.object({ expectedRevision: revision, mode: check.wakeMode, senderIds: check.list(check.identifier, 2000) });
export const memberChange = check.object({ expectedRevision: revision, status: check.optional(check.status), displayName: check.optional(check.text(HUMAN_SIGNUP.labelMax)) });
export const memberRole = check.object({ expectedRevision: revision, roleCode: check.choice('member', 'administrator') });
export const memberInvitation = check.object({ roleCode: check.choice('member', 'administrator'), expiresSeconds: check.integer(60, 604800) });
export const invitationClaim = check.object({ claimSecret: check.secret });
export const grantIntent = check.object({ roomId: check.roomId, accessMode: check.choice('read', 'reply', 'custom'), powerLevel: check.nullable(check.integer(Number.MIN_SAFE_INTEGER)), muted: check.boolean });
export const roomGrant = check.object({ expectedRevision: revision, expectedGeneration: check.nullable(check.identifier), accessMode: check.choice('read', 'reply', 'custom'), powerLevel: check.nullable(check.integer(Number.MIN_SAFE_INTEGER)), muted: check.boolean });
export const removeGrant = check.object({ expectedRevision: revision, expectedGeneration: check.nullable(check.identifier) });
export const roomPermissions = check.object({ expectedRevision: revision, expectedGeneration: check.identifier, permissions: check.list(check.choice('room.agent.invite'), 1) });
export const heartbeat = check.object({ release: check.text(200), messagesDelivered: check.integer(), stopped: check.boolean,
  controller: check.object({ fleetId: check.identifier, connectionId: check.identifier, credential: check.text(200) }), statistics: check.nullable(statisticsBatch) });
export const wakeNotice = check.object({ roomId: check.roomId });
export const principalResolution = check.object({ matrixUserIds: check.refine(check.list(check.matrixUserId, 100, 1),
  ids => new Set(ids).size === ids.length, 'Resolve unique Matrix identities') });
export const plan = check.object({ fleetId: check.identifier, agents: check.list(check.object({ instanceKey: check.name, grants: check.list(grantIntent, 100) }), 100, 1) });
export const planPreview = check.object({ plan });
export const planChange = check.object({ plan, digest: check.text(64, 64), snapshots: check.list(check.object({ agentId: check.identifier, revision,
  grants: check.list(check.object({ roomId: check.roomId, generation: check.identifier, revision }), 100) }), 100, 1) });
export const policy = check.object({ expectedRevision: revision, maxOwnerAgents: check.integer(1, 100), maxAgents: check.integer(1, 1000), maxPending: check.integer(1, 1000),
  maxMessageBytes: check.integer(4096, 4194304),
  fleetIdleTimeoutSeconds: check.integer(0, 604800),
  enrollmentSeconds: check.integer(60, 3600), reconcileSeconds: check.integer(30, 3600), agentInstructions: check.multiline,
  signupMode: check.choice('invitation', 'open'), invitationIssuers: check.choice('administrators', 'members') });

export type ListQuery = { page: number; pageSize: number; search: string; status: ('active' | 'suspended' | 'revoked')[]; kind: 'all' | 'human' | 'agent'; listener: 'all' | 'online' | 'offline' | 'disconnecting'; agentId?: string };
export function listQuery(allowed: readonly string[]): Parser<URLSearchParams> {
  return input => {
    if (!(input instanceof URLSearchParams) || [...input.keys()].some(key => !allowed.includes(key) || input.getAll(key).length !== 1)) return failure('invalid', 'Unknown or duplicated query parameters');
    return success(input);
  };
}
export function pagination(input: URLSearchParams) {
  const page = Number(input.get('page') ?? 1), pageSize = Number(input.get('pageSize') ?? 20);
  return Number.isSafeInteger(page) && page >= 1 && page <= 100000 && Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 100
    ? success({ page, pageSize }) : failure('invalid', 'Use page ≥ 1 and pageSize 1–100');
}

export const fleetChange = check.object({ expectedRevision: revision, label: check.text(100), controller });
export const fleetArchive = check.object({ expectedRevision: revision });
export const fleetAgentRemoval = check.object({ expectedRevision: revision, instanceKey: check.name });
