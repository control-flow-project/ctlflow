import * as queries from "./data/queries.js";
import { HUMAN_SIGNUP, fields, text, type MemberView } from "../../../packages/contracts/src/management.js";
import { failure, success, type Result } from "../../../packages/contracts/src/result.js";
import { actor, hash, matches, record, secret, type Context, type Human } from "./context.js";
import { serviceUser } from "./config.js";

export async function createSession(ctx: Context, value: unknown): Promise<Result<{ credential: string; csrf: string; human: MemberView }>> {
  const parsed = fields(value, ["token"]);
  if (!parsed.ok) return parsed;
  if (!text(parsed.value.token, 8192)) return failure("invalid", "Invalid native token");
  const identity = await ctx.native.identify(parsed.value.token);
  if (!identity.ok) return identity;
  const member = queries.member(ctx.store, identity.value);
  if (!member || member.status !== "active" || queries.agentIdentity(ctx.store, identity.value)) {
    return failure("forbidden", "An active human membership is required");
  }
  const credential = secret();
  const csrf = secret();
  return ctx.store.transaction(() => {
    queries.pruneExpired(ctx.store, ctx.now());
    if (queries.sessionCount(ctx.store, member.id) >= 10) return failure("limit", "Human session capacity reached; end an existing session");
    queries.insertSession(ctx.store, { hash: hash(credential), member: member.id, csrf,
      token: parsed.value.token as string, expires: ctx.now() + 8 * 60 * 60 * 1000 });
    return success({ credential, csrf, human: member });
  }).immediate();
}

export async function authenticate(ctx: Context, credential: string, csrf?: string): Promise<Result<{ human: Human; member: MemberView; csrf: string }>> {
  const session = queries.session(ctx.store, hash(credential));
  if (!session || session.expires <= ctx.now()) return failure("unauthorized", "Management session expired");
  if (csrf !== undefined && csrf !== session.csrf) return failure("forbidden", "CSRF verification failed");
  const identity = await ctx.native.identify(session.token);
  if (!identity.ok) return identity;
  if (identity.value !== session.member) return failure("unauthorized", "Native session identity changed");
  const human = { id: session.member, sessionHash: session.hash };
  const current = actor(ctx, human);
  if (!current.ok) return current;
  return success({ human, member: current.value, csrf: session.csrf });
}

export function endSession(ctx: Context, credential: string): Result<void> {
  queries.deleteSession(ctx.store, hash(credential));
  return success(undefined);
}

export async function acceptInvitation(ctx: Context, id: string, value: unknown): Promise<Result<unknown>> {
  const parsed = fields(value, ["secret", "username", "password", "label"]);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!text(input.secret, 100) || !text(input.username, HUMAN_SIGNUP.usernameMax) || !new RegExp('^' + HUMAN_SIGNUP.usernamePattern + '$', 'u').test(input.username)
    || !text(input.password, HUMAN_SIGNUP.passwordMax) || input.password.length < HUMAN_SIGNUP.passwordMin || !text(input.label, HUMAN_SIGNUP.labelMax)) return failure("invalid", "Invalid invitation acceptance");
  const user = "@" + input.username + ":" + ctx.config.serverName;
  if (user === serviceUser(ctx.config) || user === "@conduit:" + ctx.config.serverName) return failure("forbidden", "Reserved native identity");
  const fingerprint = hash(JSON.stringify([input.secret, user, input.password, input.label]));
  const initial = queries.invitation(ctx.store, id);
  if (!initial || initial.revoked || initial.expires <= ctx.now() || !matches(input.secret, initial.secretHash)) {
    return failure("unauthorized", "Invalid or expired invitation");
  }
  if (initial.used) return initial.used === user ? success({ member: user }) : failure("conflict", "Invitation already consumed");
  if (!initial.claimUser) {
    const exists = await ctx.native.exists(user);
    if (!exists.ok) return exists;
    if (exists.value) return failure("conflict", "Native username is already registered");
  }
  const reserved = ctx.store.transaction((): Result<void> => {
    const invitation = queries.invitation(ctx.store, id);
    if (!invitation || invitation.revoked || invitation.expires <= ctx.now() || invitation.used || !matches(input.secret as string, invitation.secretHash)) {
      return failure("unauthorized", "Invalid or expired invitation");
    }
    if (invitation.claimUser) return invitation.claimUser === user && invitation.claimHash === fingerprint
      ? success(undefined) : failure("conflict", "Invitation is reserved for different account details");
    if (queries.agentIdentity(ctx.store, user) || queries.member(ctx.store, user) || queries.claimedInvitation(ctx.store, user)) {
      return failure("conflict", "Identity is already enrolled");
    }
    const pending = queries.invitations(ctx.store).filter(invite => invite.claimUser && !invite.used).length;
    if (queries.members(ctx.store).length + pending >= 1000) return failure("limit", "Member capacity reached");
    return queries.claimInvitation(ctx.store, id, user, input.label as string, fingerprint) === 1
      ? success(undefined) : failure("conflict", "Invitation changed during reservation");
  }).immediate();
  if (!reserved.ok) return reserved;
  const provisioned = await ctx.native.provision(user, input.password, "CROSSFIRE_HUMAN");
  if (!provisioned.ok) return provisioned;
  return ctx.store.transaction(() => {
    const invitation = queries.invitation(ctx.store, id);
    if (!invitation || invitation.revoked || invitation.expires <= ctx.now() || invitation.claimHash !== fingerprint) {
      return failure("conflict", "Invitation changed during native provisioning; cleanup is pending");
    }
    if (invitation.used) return invitation.used === user ? success({ member: user }) : failure("conflict", "Invitation already consumed");
    if (queries.member(ctx.store, user) || queries.agentIdentity(ctx.store, user)) return failure("conflict", "Native identity admission changed");
    queries.insertMember(ctx.store, { id: user, label: invitation.claimLabel!, role: invitation.role,
      status: "active", revision: 0, created: ctx.now(), appliedStatus: null, appliedRevision: null, lastSuccess: null, error: null });
    if (queries.consumeInvitation(ctx.store, id, user) !== 1) throw new Error("Reserved invitation changed");
    record(ctx, user, user, id, "invitation.accept");
    return success({ member: user, account: provisioned.value });
  }).immediate();
}
