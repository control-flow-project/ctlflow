import { executeDelete, executeInsert, executeSelect, executeUpdate } from "@tinqerjs/better-sqlite3-adapter";
import { schema, type Store, type Tables } from "./database.js";
import type { Policy, Status } from "../../../../packages/contracts/src/management.js";
import type { WakePolicy } from '../../../../packages/contracts/src/wake.js';

export function member(store: Store, id: string) {
  return executeSelect(store, schema, (query, params) => query.from("members")
    .where(row => row.id === params.id).firstOrDefault(), { id });
}

export function members(store: Store) {
  return executeSelect(store, schema, query => query.from("members").orderBy(row => row.id).take(1000));
}

export function insertMember(store: Store, input: Tables["members"]): void {
  executeInsert(store, schema, (query, params) => query.insertInto("members").values({
    id: params.id, label: params.label, role: params.role, status: params.status, revision: params.revision, created: params.created,
    appliedStatus: params.appliedStatus, appliedRevision: params.appliedRevision, lastSuccess: params.lastSuccess, error: params.error,
  }), input);
}

export function memberApplication(store: Store, id: string, expected: number, input: {
  appliedStatus: Status | null; appliedRevision: number | null; lastSuccess: number | null; error: string | null;
}) {
  return executeUpdate(store, schema, (query, params) => query.update("members")
    .set({ appliedStatus: params.appliedStatus, appliedRevision: params.appliedRevision, lastSuccess: params.lastSuccess, error: params.error })
    .where(row => row.id === params.id && row.revision === params.expected), { id, expected, ...input });
}

export function updateMember(store: Store, input: Tables["members"], expected: number) {
  return executeUpdate(store, schema, (query, params) => query.update("members")
    .set(row => ({ label: params.label, role: params.role, status: params.status, revision: row.revision + 1 }))
    .where(row => row.id === params.id && row.revision === params.expected), { ...input, expected });
}

export function agent(store: Store, id: string) {
  return executeSelect(store, schema, (query, params) => query.from("agents")
    .where(row => row.id === params.id).firstOrDefault(), { id });
}

export function agentIdentity(store: Store, userId: string) {
  return executeSelect(store, schema, (query, params) => query.from("agents")
    .where(row => row.userId === params.userId).firstOrDefault(), { userId });
}

export function agents(store: Store, owner: string, administrator: boolean) {
  return executeSelect(store, schema, (query, params) => query.from("agents")
    .where(row => params.administrator === true || row.owner === params.owner).orderBy(row => row.id).take(1000), { owner, administrator });
}

export function insertAgent(store: Store, input: Tables["agents"]): void {
  executeInsert(store, schema, (query, params) => query.insertInto("agents").values({
    id: params.id, owner: params.owner, userId: params.userId, name: params.name, override: params.override, wakePolicy: params.wakePolicy,
    status: params.status, revision: params.revision, grantRevision: params.grantRevision, grants: params.grants, applied: params.applied,
    password: params.password, token: params.token, appliedRevision: params.appliedRevision, appliedGrantRevision: params.appliedGrantRevision,
    lastSuccess: params.lastSuccess, error: params.error, created: params.created,
  }), input);
}

export function changeAgent(store: Store, id: string, expected: number, status: Status, override: string | null, grants: string, grantRevision: number, wakePolicy: WakePolicy) {
  return executeUpdate(store, schema, (query, params) => query.update("agents")
    .set(row => ({ status: params.status, override: params.override, grants: params.grants, grantRevision: params.grantRevision, wakePolicy: params.wakePolicy, revision: row.revision + 1 }))
    .where(row => row.id === params.id && row.revision === params.expected), { id, expected, status, override, grants, grantRevision, wakePolicy });
}

export function application(store: Store, id: string, expected: number, input: {
  token: string | null; applied: string; appliedRevision: number | null; appliedGrantRevision: number | null;
  lastSuccess: number | null; error: string | null;
}) {
  return executeUpdate(store, schema, (query, params) => query.update("agents")
    .set({ token: params.token, applied: params.applied, appliedRevision: params.appliedRevision,
      appliedGrantRevision: params.appliedGrantRevision, lastSuccess: params.lastSuccess, error: params.error })
    .where(row => row.id === params.id && row.revision === params.expected), { id, expected, ...input });
}

export function enrollment(store: Store, id: string) {
  return executeSelect(store, schema, (query, params) => query.from("enrollments")
    .where(row => row.id === params.id).firstOrDefault(), { id });
}

export function enrollments(store: Store, owner: string, administrator: boolean, now: number) {
  return executeSelect(store, schema, (query, params) => query.from("enrollments")
    .where(row => (params.administrator === true || row.owner === params.owner) && row.expires > params.now)
    .orderBy(row => row.id).take(1000), { owner, administrator, now });
}

export function insertEnrollment(store: Store, input: Tables["enrollments"]): void {
  executeInsert(store, schema, (query, params) => query.insertInto("enrollments").values({
    id: params.id, owner: params.owner, name: params.name, code: params.code,
    secretHash: params.secretHash, status: params.status, expires: params.expires, agent: params.agent,
  }), input);
}

export function decideEnrollment(store: Store, id: string, status: "approved" | "rejected", agent: string | null) {
  return executeUpdate(store, schema, (query, params) => query.update("enrollments")
    .set({ status: params.status, agent: params.agent }).where(row => row.id === params.id && row.status === "pending"), { id, status, agent });
}

export function invitation(store: Store, id: string) {
  return executeSelect(store, schema, (query, params) => query.from("invitations")
    .where(row => row.id === params.id).firstOrDefault(), { id });
}

export function invitations(store: Store) {
  return executeSelect(store, schema, query => query.from("invitations").orderBy(row => row.id).take(1000));
}

export function insertInvitation(store: Store, input: Tables["invitations"]): void {
  executeInsert(store, schema, (query, params) => query.insertInto("invitations").values({
    id: params.id, secretHash: params.secretHash, role: params.role, expires: params.expires, used: params.used, created: params.created,
    revoked: params.revoked, claimUser: params.claimUser, claimLabel: params.claimLabel, claimHash: params.claimHash,
  }), input);
}

export function consumeInvitation(store: Store, id: string, member: string) {
  return executeUpdate(store, schema, (query, params) => query.update("invitations")
    .set({ used: params.member }).where(row => row.id === params.id && row.used === null && row.revoked === 0), { id, member });
}

export function claimInvitation(store: Store, id: string, user: string, label: string, fingerprint: string) {
  return executeUpdate(store, schema, (query, params) => query.update("invitations")
    .set({ claimUser: params.user, claimLabel: params.label, claimHash: params.fingerprint })
    .where(row => row.id === params.id && row.used === null && row.revoked === 0 && row.claimUser === null), { id, user, label, fingerprint });
}

export function revokeInvitation(store: Store, id: string) {
  return executeUpdate(store, schema, (query, params) => query.update("invitations")
    .set({ revoked: 1 }).where(row => row.id === params.id && row.used === null), { id });
}

export function claimedInvitation(store: Store, user: string) {
  return executeSelect(store, schema, (query, params) => query.from("invitations")
    .where(row => row.claimUser === params.user).firstOrDefault(), { user });
}

export function deleteInvitation(store: Store, id: string) {
  return executeDelete(store, schema, (query, params) => query.deleteFrom("invitations")
    .where(row => row.id === params.id), { id });
}

export function session(store: Store, hash: string) {
  return executeSelect(store, schema, (query, params) => query.from("sessions")
    .where(row => row.hash === params.hash).firstOrDefault(), { hash });
}

export function insertSession(store: Store, input: Tables["sessions"]): void {
  executeInsert(store, schema, (query, params) => query.insertInto("sessions").values({
    hash: params.hash, member: params.member, csrf: params.csrf, token: params.token, expires: params.expires,
  }), input);
}

export function sessionCount(store: Store, member: string) {
  return executeSelect(store, schema, (query, params) => query.from("sessions")
    .where(row => row.member === params.member).count(), { member });
}

export function pruneExpired(store: Store, now: number): void {
  executeDelete(store, schema, (query, params) => query.deleteFrom("sessions").where(row => row.expires <= params.now), { now });
  executeDelete(store, schema, (query, params) => query.deleteFrom("enrollments").where(row => row.expires <= params.now), { now });
}

export function deleteSession(store: Store, hash: string) {
  return executeDelete(store, schema, (query, params) => query.deleteFrom("sessions").where(row => row.hash === params.hash), { hash });
}

export function readPolicy(store: Store) {
  return executeSelect(store, schema, query => query.from("policy").select(row => ({
    revision: row.revision, maxOwnerAgents: row.maxOwnerAgents, maxAgents: row.maxAgents,
    maxPending: row.maxPending, enrollmentSeconds: row.enrollmentSeconds, reconcileSeconds: row.reconcileSeconds,
    agentInstructions: row.agentInstructions,
  })).firstOrDefault());
}

export function insertPolicy(store: Store, input: Policy): void {
  executeInsert(store, schema, (query, params) => query.insertInto("policy").values({
    id: "instance", revision: params.revision, maxOwnerAgents: params.maxOwnerAgents,
    maxAgents: params.maxAgents, maxPending: params.maxPending,
    enrollmentSeconds: params.enrollmentSeconds, reconcileSeconds: params.reconcileSeconds,
    agentInstructions: params.agentInstructions,
  }), input);
}

export function updatePolicy(store: Store, input: Policy) {
  return executeUpdate(store, schema, (query, params) => query.update("policy")
    .set(row => ({ revision: row.revision + 1, maxOwnerAgents: params.maxOwnerAgents, maxAgents: params.maxAgents,
      maxPending: params.maxPending, enrollmentSeconds: params.enrollmentSeconds, reconcileSeconds: params.reconcileSeconds,
      agentInstructions: params.agentInstructions }))
    .where(row => row.id === "instance" && row.revision === params.revision), input);
}

export function insertAudit(store: Store, input: Omit<Tables["audit"], "id">): void {
  executeInsert(store, schema, (query, params) => query.insertInto("audit").values({
    actor: params.actor, owner: params.owner, target: params.target, action: params.action, detail: params.detail, created: params.created,
  }), input);
}

export function audit(store: Store, actor: string, administrator: boolean, before: number) {
  return executeSelect(store, schema, (query, params) => query.from("audit")
    .where(row => (params.administrator === true || row.actor === params.actor || row.owner === params.actor) && row.id < params.before)
    .orderByDescending(row => row.id).take(100), { actor, administrator, before });
}
