import { randomBytes, randomUUID } from "node:crypto";
import * as queries from "./data/queries.js";
import { fields, text, userId } from "../../../packages/contracts/src/management.js";
import { failure, success, type Result } from "../../../packages/kernel/src/result.js";
import { actor, hash, matches, record, secret, type Context, type Human } from "./context.js";
import { profileName } from '../../../packages/contracts/src/client.js';
import { approveName, claimName, nameClaim, releaseName } from './data/fleets.js';

export function requestEnrollment(ctx: Context, value: unknown, batch: string | null = null): Result<unknown> {
  const parsed = fields(value, ["owner", "name"]);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!userId(input.owner) || !profileName(input.name)) return failure("invalid", "Agent names use 1..40 lowercase letters, digits and hyphens");
  return ctx.store.transaction(() => {
    queries.pruneExpired(ctx.store, ctx.now());
    const owner = queries.member(ctx.store, input.owner as string);
    if (!owner || owner.status !== "active") return failure("forbidden", "Owner is not eligible for enrollment");
    const policy = queries.readPolicy(ctx.store)!;
    if (nameClaim(ctx.store, input.name as string)) return failure('conflict', 'Name collision: ' + input.name);
    const pending = queries.enrollments(ctx.store, "", true, ctx.now()).filter(request => request.status === 'pending');
    if (pending.length >= policy.maxPending) {
      return failure("limit", "Pending enrollment capacity reached");
    }
    const active = queries.agents(ctx.store, '', true).filter(agent => agent.status !== 'revoked');
    if (active.length + pending.length >= policy.maxAgents
      || active.filter(agent => agent.owner === owner.id).length + pending.filter(request => request.owner === owner.id).length >= policy.maxOwnerAgents) {
      return failure('limit', 'Identity capacity reached; administrator must increase the configured agent limit');
    }
    const credential = secret();
    const request = { id: randomUUID(), owner: owner.id, name: input.name as string,
      code: randomBytes(6).toString("hex").toUpperCase(), secretHash: hash(credential),
      status: "pending" as const, expires: ctx.now() + policy.enrollmentSeconds * 1000, agent: null, batch };
    queries.insertEnrollment(ctx.store, request);
    claimName(ctx.store, request.name, request.id);
    return success({ id: request.id, owner: request.owner, name: request.name, code: request.code,
      expires: request.expires, secret: credential, approvalUrl: ctx.config.publicOrigin + "/manage/enrollments/" + request.id });
  }).immediate();
}

export function decide(ctx: Context, human: Human, id: string, value: unknown, batch: string | null = null): Result<unknown> {
  const parsed = fields(value, ["decision", "code"]);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if ((input.decision !== "approve" && input.decision !== "reject") || !text(input.code, 12)) return failure("invalid", "Invalid enrollment decision");
  return ctx.store.transaction(() => {
    const current = actor(ctx, human);
    if (!current.ok) return current;
    const request = queries.enrollment(ctx.store, id);
    if (!request || request.expires <= ctx.now()) return failure("missing", "Enrollment expired or missing");
    if (request.batch !== batch) return failure('forbidden', 'Review this identity in its complete fleet enrollment');
    if (request.owner !== human.id && !(current.value.role === "administrator" && input.decision === "reject")) {
      return failure("forbidden", "Only the intended owner can approve");
    }
    if (request.status !== "pending" || request.code !== input.code) return failure("conflict", "Enrollment changed or code does not match");
    const owner = queries.member(ctx.store, request.owner);
    if (!owner || owner.status !== "active") return failure("forbidden", "Owner is not active");
    let agentId: string | null = null;
    if (input.decision === "approve") {
      const policy = queries.readPolicy(ctx.store)!;
      const all = queries.agents(ctx.store, "", true);
      if (all.length >= 1000) return failure("limit", "Stored identity capacity reached");
      const current = all.filter(agent => agent.status !== "revoked");
      const pending = queries.enrollments(ctx.store, '', true, ctx.now()).filter(entry => entry.status === 'pending' && entry.id !== id);
      if (current.length + pending.length >= policy.maxAgents || current.filter(agent => agent.owner === owner.id).length + pending.filter(entry => entry.owner === owner.id).length >= policy.maxOwnerAgents) {
        return failure("limit", "Agent capacity reached");
      }
      agentId = randomUUID();
      queries.insertAgent(ctx.store, {
        id: agentId, owner: owner.id, userId: "@agent-" + agentId + ":" + ctx.config.serverName,
        name: request.name, override: null, status: "active", wakePolicy: 'owner', revision: 0, grantRevision: 0, grants: "[]", applied: "[]",
        password: secret(), token: null, appliedRevision: null, appliedGrantRevision: null, lastSuccess: null, error: null, created: ctx.now(),
      });
      approveName(ctx.store, id, agentId);
    }
    else releaseName(ctx.store, id);
    queries.decideEnrollment(ctx.store, id, input.decision === "approve" ? "approved" : "rejected", agentId);
    record(ctx, human.id, owner.id, id, "enrollment." + input.decision, { name: request.name, agent: agentId });
    return success({ id, status: input.decision === "approve" ? "approved" : "rejected", agent: agentId });
  }).immediate();
}

export function exchange(ctx: Context, id: string, value: unknown): Result<unknown> {
  const parsed = fields(value, ["secret"]);
  if (!parsed.ok) return parsed;
  if (!text(parsed.value.secret, 100)) return failure("invalid", "Invalid initiating credential");
  const request = queries.enrollment(ctx.store, id);
  if (!request || request.expires <= ctx.now() || !matches(parsed.value.secret, request.secretHash)) {
    return failure("unauthorized", "Invalid or expired enrollment credential");
  }
  if (request.status !== "approved") return success({ status: request.status });
  const owner = queries.member(ctx.store, request.owner);
  const agent = request.agent ? queries.agent(ctx.store, request.agent) : null;
  if (!owner || owner.status !== "active" || !agent || agent.status !== "active") return failure("forbidden", "Enrollment access is no longer active");
  if (!agent.token || !agent.lastSuccess || agent.error !== null) return success({ status: "provisioning", error: agent.error });
  return success({ status: "ready", id: agent.id, owner: agent.owner,
    account: { user_id: agent.userId, access_token: agent.token, device_id: "CROSSFIRE_AGENT" } });
}
