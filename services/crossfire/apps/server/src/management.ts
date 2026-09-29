import { randomUUID } from "node:crypto";
import * as queries from "./data/queries.js";
import { authorityChanged, fields, grants, policy, revision, role, status, text, sameAccess, INVITATION_LIFETIME, type AgentView, type Grant } from "../../../packages/contracts/src/management.js";
import { failure, success, type Result } from "../../../packages/kernel/src/result.js";
import { actor, agentRecord, hash, record, secret, type Context, type Human } from "./context.js";
import { eligible, grantLevel } from "./rooms.js";
import { activity } from './activity.js';
import { disconnectListeners } from './data/listeners.js';
import { LISTENER_EXPIRY_MS } from '../../../packages/contracts/src/activity.js';
import { wakePolicy } from '../../../packages/contracts/src/wake.js';
import { wakeSenders, replaceWakeSenders } from './data/wake.js';
import { activeIdentities } from './identities.js';
import { userId } from '../../../packages/contracts/src/management.js';

export function agentView(ctx: Context, agent: NonNullable<ReturnType<typeof queries.agent>>): AgentView {
  const desired = grants(JSON.parse(agent.grants));
  const applied = grants(JSON.parse(agent.applied));
  if (!desired.ok || !applied.ok) throw new Error("Corrupt stored agent grants");
  const owner = queries.member(ctx.store, agent.owner);
  if (!owner) throw new Error("Agent owner is missing");
  return { id: agent.id, owner: agent.owner, userId: agent.userId, wakePolicy: agent.wakePolicy, wakeSenders: wakeSenders(ctx.store, agent.id),
    name: agent.override ?? agent.name + " (" + owner.label + ")", nativeName: null,
    status: agent.status, ownerStatus: owner.status, revision: agent.revision, grantRevision: agent.grantRevision,
    grants: desired.value, applied: applied.value, appliedGrantRevision: agent.appliedGrantRevision,
    appliedRevision: agent.appliedRevision, lastSuccess: agent.lastSuccess, error: agent.error, activity: activity(ctx, agent.id) };
}

export function changeAgent(ctx: Context, human: Human, id: string, value: unknown): Result<unknown> {
  const parsed = fields(value, ["revision"], ["status", "name", 'wakePolicy', 'wakeSenders']);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!revision(input.revision) || (input.status !== undefined && !status(input.status))
    || input.wakePolicy !== undefined && !wakePolicy(input.wakePolicy)
    || (input.name !== undefined && input.name !== null && !text(input.name, 200))) return failure("invalid", "Invalid agent change");
  if (input.wakePolicy === 'selected' ? !Array.isArray(input.wakeSenders) || input.wakeSenders.length > 2000
    || !input.wakeSenders.every(userId) || new Set(input.wakeSenders).size !== input.wakeSenders.length
    : input.wakeSenders !== undefined) return failure('invalid', 'Selected wake policy requires a complete unique list of Matrix identities');
  return ctx.store.transaction(() => {
    const current = actor(ctx, human, input.name !== undefined);
    if (!current.ok) return current;
    const found = agentRecord(ctx, human, id);
    if (!found.ok) return found;
    const agent = found.value;
    if (agent.revision !== input.revision) return failure("conflict", "Agent revision changed");
    if (agent.status === "revoked") return failure("conflict", "Revocation is permanent; enroll a new identity");
    const nextStatus = status(input.status) ? input.status : agent.status;
    const nextWake = wakePolicy(input.wakePolicy) ? input.wakePolicy : agent.wakePolicy;
    if (input.wakePolicy === 'selected') {
      const available = new Set(activeIdentities(ctx).filter(identity => identity.id !== agent.userId).map(identity => identity.id));
      if (!(input.wakeSenders as string[]).every(sender => available.has(sender))) return failure('invalid', 'Choose active people or agents other than this agent');
    }
    const override = input.name === undefined ? agent.override : input.name as string | null;
    if (queries.changeAgent(ctx.store, id, agent.revision, nextStatus, override, agent.grants, agent.grantRevision, nextWake) !== 1) return failure("conflict", "Agent revision changed");
    if (input.wakePolicy !== undefined) replaceWakeSenders(ctx.store, id, nextWake === 'selected' ? input.wakeSenders as string[] : []);
    if (nextStatus !== 'active') disconnectListeners(ctx.store, id, ctx.now() - LISTENER_EXPIRY_MS);
    record(ctx, human.id, agent.owner, id, "agent.change", { status: nextStatus, name: override, wakePolicy: nextWake, wakeSenders: wakeSenders(ctx.store, id) });
    return success(agentView(ctx, queries.agent(ctx.store, id)!));
  }).immediate();
}

function expands(previous: Grant[], next: Grant[]): boolean {
  return next.some(grant => {
    const old = previous.find(value => value.room === grant.room);
    return !old || !sameAccess(old, grant) && grant.access !== 'read'
      && !(old.access === 'custom' && grant.access === 'custom' && grant.level <= old.level);
  });
}

export async function changeGrants(ctx: Context, human: Human, id: string, value: unknown): Promise<Result<unknown>> {
  const parsed = fields(value, ["revision", "grants"]);
  if (!parsed.ok) return parsed;
  if (!revision(parsed.value.revision)) return failure("invalid", "Invalid grant revision");
  const next = grants(parsed.value.grants);
  if (!next.ok) return next;
  const found = agentRecord(ctx, human, id);
  if (!found.ok) return found;
  const agent = found.value;
  if (agent.revision !== parsed.value.revision) return failure("conflict", "Agent revision changed");
  const old = grants(JSON.parse(agent.grants));
  if (!old.ok) throw new Error("Corrupt stored grants");
  const applied = grants(JSON.parse(agent.applied));
  if (!applied.ok) throw new Error("Corrupt applied grants");
  const ceiling = agent.appliedGrantRevision === agent.grantRevision ? applied.value : old.value;
  const expanding = expands(ceiling, next.value);
  if (expanding && human.id !== agent.owner) return failure("forbidden", "Only the owner expands delegation");
  if (agent.status !== "active") return failure("conflict", "Agent is not active");
  const owner = queries.member(ctx.store, agent.owner);
  if (!owner || owner.status !== "active") return failure("forbidden", "Owner is not active");
  if (authorityChanged(old.value, next.value) && next.value.some(grant => grant.access !== 'read') || expanding) {
    const rooms = await eligible(ctx, owner.id);
    if (!rooms.ok) return rooms;
    for (const grant of next.value) {
      const facts = rooms.value.find(room => room.room === grant.room);
      if (!facts) return failure("forbidden", "Room is outside the owner's current access");
      const level = grantLevel(facts, grant);
      if (!level.ok) return level;
    }
  }
  return ctx.store.transaction(() => {
    const authority = agentRecord(ctx, human, id);
    if (!authority.ok) return authority;
    const currentOwner = queries.member(ctx.store, owner.id);
    if (!currentOwner || currentOwner.status !== "active" || currentOwner.revision !== owner.revision) return failure("conflict", "Owner authority changed");
    const nextRevision = agent.grantRevision + (authorityChanged(old.value, next.value) ? 1 : 0);
    if (queries.changeAgent(ctx.store, id, agent.revision, agent.status, agent.override, JSON.stringify(next.value), nextRevision, agent.wakePolicy) !== 1) {
      return failure("conflict", "Agent revision changed");
    }
    record(ctx, human.id, agent.owner, id, "grants.replace", { grants: next.value });
    return success(agentView(ctx, queries.agent(ctx.store, id)!));
  }).immediate();
}

export function changeMember(ctx: Context, human: Human, id: string, value: unknown): Result<unknown> {
  const parsed = fields(value, ["revision"], ["role", "status"]);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!revision(input.revision) || (input.role !== undefined && !role(input.role))
    || (input.status !== undefined && !status(input.status))) return failure("invalid", "Invalid member change");
  return ctx.store.transaction(() => {
    const current = actor(ctx, human, true);
    if (!current.ok) return current;
    const member = queries.member(ctx.store, id);
    if (!member) return failure("missing", "Member not found");
    if (member.status === "revoked") return failure("conflict", "Revocation is permanent");
    const nextRole = role(input.role) ? input.role : member.role;
    const nextStatus = status(input.status) ? input.status : member.status;
    if (member.role === "administrator" && member.status === "active" && (nextRole !== "administrator" || nextStatus !== "active")
      && queries.members(ctx.store).filter(member => member.role === "administrator" && member.status === "active").length === 1) {
      return failure("forbidden", "At least one active management administrator is required");
    }
    if (queries.updateMember(ctx.store, { ...member, role: nextRole, status: nextStatus }, input.revision as number) !== 1) return failure("conflict", "Member revision changed");
    if (nextStatus !== 'active') {
      for (const agent of queries.agents(ctx.store, id, false)) disconnectListeners(ctx.store, agent.id, ctx.now() - LISTENER_EXPIRY_MS);
    }
    if (nextStatus === "revoked") {
      for (const agent of queries.agents(ctx.store, id, false).filter(agent => agent.status !== "revoked")) {
        queries.changeAgent(ctx.store, agent.id, agent.revision, "revoked", agent.override, "[]", agent.grantRevision + 1, agent.wakePolicy);
        record(ctx, human.id, id, agent.id, "agent.owner-revoke");
      }
    }
    record(ctx, human.id, id, id, "member.change", { role: nextRole, status: nextStatus });
    return success(queries.member(ctx.store, id));
  }).immediate();
}

export function changePolicy(ctx: Context, human: Human, value: unknown): Result<unknown> {
  const parsed = policy(value);
  if (!parsed.ok) return parsed;
  return ctx.store.transaction(() => {
    const current = actor(ctx, human, true);
    if (!current.ok) return current;
    if (queries.updatePolicy(ctx.store, parsed.value) !== 1) return failure("conflict", "Policy revision changed");
    record(ctx, human.id, human.id, "instance", "policy.change", parsed.value);
    return success(queries.readPolicy(ctx.store));
  }).immediate();
}

export function createInvitation(ctx: Context, human: Human, value: unknown): Result<unknown> {
  const parsed = fields(value, ["role", "expiresSeconds"]);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!role(input.role) || typeof input.expiresSeconds !== "number" || !Number.isSafeInteger(input.expiresSeconds)
    || input.expiresSeconds < INVITATION_LIFETIME.min || input.expiresSeconds > INVITATION_LIFETIME.max) return failure("invalid", "Invalid invitation");
  return ctx.store.transaction(() => {
    const current = actor(ctx, human, true);
    if (!current.ok) return current;
    if (queries.invitations(ctx.store).length >= 1000) return failure("limit", "Invitation capacity reached");
    const credential = secret();
    const invitation = { id: randomUUID(), secretHash: hash(credential), role: input.role as "member" | "administrator",
      expires: ctx.now() + Number(input.expiresSeconds) * 1000, used: null, created: ctx.now(),
      revoked: 0, claimUser: null, claimLabel: null, claimHash: null };
    queries.insertInvitation(ctx.store, invitation);
    record(ctx, human.id, human.id, invitation.id, "invitation.create", { role: invitation.role });
    return success({ id: invitation.id, secret: credential, role: invitation.role, expires: invitation.expires });
  }).immediate();
}

export function revokeInvitation(ctx: Context, human: Human, id: string): Result<void> {
  return ctx.store.transaction(() => {
    const current = actor(ctx, human, true);
    if (!current.ok) return current;
    if (queries.revokeInvitation(ctx.store, id) !== 1) return failure("conflict", "Invitation is missing or consumed");
    record(ctx, human.id, human.id, id, "invitation.revoke");
    return success(undefined);
  }).immediate();
}
