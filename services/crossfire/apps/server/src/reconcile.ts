import * as queries from "./data/queries.js";
import { authorityChanged, grants, object, sameAccess, type Grant } from "../../../packages/contracts/src/management.js";
import { failure, success, type Result } from "../../../packages/kernel/src/result.js";
import { API, nativeOk, segment, type Native } from "../../../packages/matrix/src/http.js";
import { record, type Context } from "./context.js";
import { agentView } from "./management.js";
import { grantLevel, joined, roomFacts } from "./rooms.js";
import type { Tables } from "./data/database.js";

async function leave(client: Native, room: string): Promise<Result<void>> {
  const response = await nativeOk(client, "POST", API + "/rooms/" + segment(room) + "/leave", {});
  return response.ok ? success(undefined) : response;
}

async function restrict(ctx: Context, agent: Tables["agents"], client: Native): Promise<Result<Grant[]>> {
  const owner = queries.member(ctx.store, agent.owner);
  const desired = grants(JSON.parse(agent.grants));
  if (!desired.ok) throw new Error("Corrupt persisted grants");
  const existing = await joined(client);
  if (!existing.ok) return existing;
  const previous = grants(JSON.parse(agent.applied));
  if (!previous.ok) throw new Error("Corrupt applied grants");
  const command = agent.appliedGrantRevision !== agent.grantRevision;
  const targets = owner?.status === "active" && agent.status === "active" ? desired.value.flatMap(grant => {
    const old = previous.value.find(value => value.room === grant.room);
    const expansion = command && (!old || !sameAccess(old, grant));
    if (!existing.value.includes(grant.room) && !expansion) return [];
    return [!expansion && old ? { ...old, muted: grant.muted } : grant];
  }) : [];
  const permitted = new Set(targets.map(grant => grant.room));
  for (const room of existing.value.filter(room => !permitted.has(room))) {
    const result = await leave(client, room);
    if (!result.ok) return result;
  }
  if (!targets.length) return success([]);
  const ownerClient = await ctx.native.asUser(agent.owner);
  if (!ownerClient.ok) return ownerClient;
  const ownerRooms = await joined(ownerClient.value);
  if (!ownerRooms.ok) return ownerRooms;
  const applied: Grant[] = [];
  async function denied(room: string, result: Result<unknown>): Promise<Result<Grant[]>> {
    if (existing.ok && existing.value.includes(room)) {
      const removed = await leave(client, room);
      if (!removed.ok) return failure("native", "Restriction failed and native room removal is unconfirmed");
    }
    return result.ok ? failure("native", "Restriction could not be verified") : result;
  }
  for (const grant of targets) {
    const latest = queries.agent(ctx.store, agent.id);
    const currentOwner = queries.member(ctx.store, agent.owner);
    if (!latest || latest.revision !== agent.revision || !currentOwner || currentOwner.status !== "active") {
      return failure("conflict", "Desired authority changed during native application");
    }
    if (!ownerRooms.value.includes(grant.room)) {
      if (existing.value.includes(grant.room)) {
        const result = await leave(client, grant.room);
        if (!result.ok) return result;
      }
      continue;
    }
    const facts = await roomFacts(ownerClient.value, agent.owner, grant.room);
    if (!facts.ok) return denied(grant.room, facts);
    if (facts.value.creators.includes(agent.userId)) {
      return denied(grant.room, failure("native", "Native creator authority cannot be narrowed to this grant"));
    }
    const old = previous.value.find(value => value.room === grant.room);
    const expansion = command && (!old || !sameAccess(old, grant));
    const effective: Grant = grant.access === 'custom' && !facts.value.ownerCreator
      ? { ...grant, level: Math.min(grant.level, facts.value.ownerLevel) }
      : !expansion && grant.access === "reply" && !facts.value.ownerCreator
      && facts.value.ownerLevel < Math.max(facts.value.message, facts.value.reaction)
      ? { ...grant, access: "read" as const } : grant;
    const level = grantLevel(facts.value, effective);
    if (!level.ok) return denied(grant.room, level);
    const powers = facts.value.powers;
    const users = object(powers.users ?? {});
    if (!users.ok) return failure("native", "Invalid native user levels");
    const currentLevel = users.value[agent.userId] ?? powers.users_default ?? 0;
    if (typeof currentLevel !== "number" || !Number.isSafeInteger(currentLevel)) return failure("native", "Invalid current agent power level");
    const targetLevel = expansion ? level.value : Math.min(currentLevel, level.value);
    if (currentLevel !== targetLevel) {
      const result = await nativeOk(ownerClient.value, "PUT", API + "/rooms/" + segment(grant.room) + "/state/m.room.power_levels", {
        ...powers, users: { ...users.value, [agent.userId]: targetLevel },
      });
      if (!result.ok) return denied(grant.room, result);
    }
    if (!existing.value.includes(grant.room)) {
      const invited = await nativeOk(ownerClient.value, "POST", API + "/rooms/" + segment(grant.room) + "/invite", { user_id: agent.userId });
      if (!invited.ok) return invited;
      const joinedRoom = await nativeOk(client, "POST", API + "/rooms/" + segment(grant.room) + "/join", {});
      if (!joinedRoom.ok) return joinedRoom;
    }
    const verified = await nativeOk(client, "GET", API + "/rooms/" + segment(grant.room) + "/state/m.room.power_levels");
    if (!verified.ok) return verified;
    const verifiedUsers = object(verified.value.users ?? {});
    if (!verifiedUsers.ok || (verifiedUsers.value[agent.userId] ?? verified.value.users_default ?? 0) !== targetLevel) {
      return failure("native", "Applied native room level could not be verified");
    }
    applied.push(effective.access === 'custom' ? { ...effective, level: targetLevel }
      : { ...effective, access: targetLevel >= Math.max(facts.value.message, facts.value.reaction) ? "reply" : "read" });
  }
  return success(applied);
}

export async function reconcileAgent(ctx: Context, id: string): Promise<Result<void>> {
  let agent = queries.agent(ctx.store, id);
  if (!agent) return failure("missing", "Agent not found");
  const owner = queries.member(ctx.store, agent.owner);
  if (!owner) throw new Error("Agent owner is missing");
  const fail = (result: Result<unknown>): Result<void> => {
    if (result.ok) return success(undefined);
    const current = queries.agent(ctx.store, id)!;
    queries.application(ctx.store, id, agent!.revision, {
      token: current.token, applied: current.applied, appliedRevision: current.appliedRevision,
      appliedGrantRevision: current.appliedGrantRevision,
      lastSuccess: current.lastSuccess, error: result.error.message,
    });
    return result;
  };
  if (agent.status === "revoked" || owner.status === "revoked") {
    const exists = await ctx.native.exists(agent.userId);
    if (!exists.ok) return fail(exists);
    if (exists.value) {
      const removed = await ctx.native.deactivate(agent.userId);
      if (!removed.ok) return fail(removed);
    }
    const updated = queries.application(ctx.store, id, agent.revision, {
      token: null, applied: "[]", appliedRevision: agent.revision, lastSuccess: ctx.now(), error: null,
      appliedGrantRevision: agent.grantRevision,
    });
    return updated === 1 ? success(undefined) : failure("conflict", "Agent changed during revocation");
  }
  if (!agent.token) {
    const provisioned = await ctx.native.provision(agent.userId, agent.password);
    if (!provisioned.ok) return fail(provisioned);
    const updated = queries.application(ctx.store, id, agent.revision, {
      token: provisioned.value.access_token, applied: agent.applied, appliedRevision: agent.appliedRevision,
      appliedGrantRevision: agent.appliedGrantRevision,
      lastSuccess: agent.lastSuccess, error: null,
    });
    if (updated !== 1) return failure("conflict", "Agent changed during provisioning");
    agent = queries.agent(ctx.store, id)!;
  }
  const account = await ctx.native.identify(agent.token!);
  if (!account.ok || account.value !== agent.userId) return fail(failure("native", "The agent's native client credential is not active"));
  const client = await ctx.native.asUser(agent.userId);
  if (!client.ok) return fail(client);
  const restricted = await restrict(ctx, agent, client.value);
  if (!restricted.ok) return fail(restricted);
  if (agent.appliedRevision !== agent.revision) {
    const named = await nativeOk(client.value, "PUT", API + "/profile/" + segment(agent.userId) + "/displayname", { displayname: agentView(ctx, agent).name });
    if (!named.ok) return fail(named);
  }
  const updated = ctx.store.transaction(() => {
    const snapshot = agent!;
    const current = queries.agent(ctx.store, id);
    if (!current || current.revision !== snapshot.revision) return 0;
    const applied = JSON.stringify(restricted.value);
    let revision = snapshot.revision;
    let grantRevision = snapshot.grantRevision;
    if (snapshot.grants !== applied) {
      const desired = grants(JSON.parse(snapshot.grants));
      if (!desired.ok) throw new Error("Corrupt persisted grants");
      grantRevision += authorityChanged(desired.value, restricted.value) ? 1 : 0;
      if (queries.changeAgent(ctx.store, id, revision, snapshot.status, snapshot.override, applied, grantRevision, snapshot.wakePolicy) !== 1) return 0;
      revision++;
      record(ctx, "service", snapshot.owner, id, "native.grants.reduce", { grants: restricted.value });
    }
    return queries.application(ctx.store, id, revision, {
      token: snapshot.token, applied, appliedRevision: revision, appliedGrantRevision: grantRevision, lastSuccess: ctx.now(), error: null,
    });
  }).immediate();
  return updated === 1 ? success(undefined) : failure("conflict", "Agent changed during native application");
}

export async function reconcileMember(ctx: Context, id: string): Promise<Result<void>> {
  const member = queries.member(ctx.store, id);
  if (!member) return failure("missing", "Member not found");
  let result: Result<void> = success(undefined);
  if (member.status === "revoked") result = await ctx.native.deactivate(id);
  else if (member.status === "suspended") {
    const client = await ctx.native.asUser(id);
    if (!client.ok) result = client;
    else {
      const rooms = await joined(client.value);
      if (!rooms.ok) result = rooms;
      else for (const room of rooms.value) {
        const current = queries.member(ctx.store, id);
        if (!current || current.revision !== member.revision) { result = failure("conflict", "Member authority changed during native application"); break; }
        result = await leave(client.value, room);
        if (!result.ok) break;
      }
    }
  }
  const updated = queries.memberApplication(ctx.store, id, member.revision, {
    appliedStatus: result.ok ? member.status : member.appliedStatus,
    appliedRevision: result.ok ? member.revision : member.appliedRevision,
    lastSuccess: result.ok ? ctx.now() : member.lastSuccess, error: result.ok ? null : result.error.message,
  });
  return updated === 1 ? result : failure("conflict", "Member changed during native application");
}

async function maintenance(ctx: Context): Promise<void> {
  queries.pruneExpired(ctx.store, ctx.now());
  for (const invitation of queries.invitations(ctx.store)) {
    if (!invitation.revoked && invitation.expires > ctx.now()) continue;
    if (!invitation.used && invitation.claimUser) {
      const removed = await ctx.native.discard(invitation.claimUser);
      if (!removed.ok) continue;
    }
    queries.deleteInvitation(ctx.store, invitation.id);
  }
}

export function reconciler(ctx: Context) {
  let running: Promise<void> | undefined;
  let pending = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function drain(): Promise<void> {
    if (running || stopped) { pending = !stopped; return running; }
    running = (async () => {
      do {
        pending = false;
        await maintenance(ctx);
        for (const member of queries.members(ctx.store)) {
          if (stopped) break;
          await reconcileMember(ctx, member.id);
        }
        for (const agent of queries.agents(ctx.store, "", true)) {
          if (stopped) break;
          await reconcileAgent(ctx, agent.id);
        }
      } while (pending && !stopped);
    })().catch(() => {
      process.stderr.write("Crossfire reconciliation failed; unverified native work remains pending.\n");
    }).finally(() => {
      running = undefined;
      if (!stopped) {
        const seconds = queries.readPolicy(ctx.store)!.reconcileSeconds;
        timer = setTimeout(() => { void drain(); }, seconds * 1000);
        timer.unref();
      }
    });
    return running;
  }
  function wake(): void {
    if (timer) clearTimeout(timer);
    void drain();
  }
  async function stop(): Promise<void> {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
  }
  return { wake, drain, stop };
}
