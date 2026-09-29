import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { openStore } from "../apps/server/src/data/database.js";
import * as queries from "../apps/server/src/data/queries.js";
import { context, hash, secret, type Context, type Human } from "../apps/server/src/context.js";
import { authenticate, endSession } from "../apps/server/src/sessions.js";
import { changeAgent, changeGrants, changeMember, changePolicy, createInvitation } from "../apps/server/src/management.js";
import { decide, exchange, requestEnrollment } from "../apps/server/src/enrollment.js";
import { success, type Result } from "../packages/contracts/src/result.js";
import type { Native } from "../packages/matrix/src/http.js";
import { deliverySettings } from '../apps/server/src/delivery.js';
import { deliveryPolicy } from '../packages/contracts/src/delivery.js';

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? "" : result.error.message);
  return result.value;
}

function fixture() {
  const store = openStore(":memory:");
  const ctx = context(store, { instance: "tests", serverName: "tests.localhost", publicOrigin: "http://127.0.0.1",
    matrixOrigin: "http://127.0.0.1", administrator: "@admin:tests.localhost", registrationSecret: secret(), jwtSecret: secret() });
  function member(id: string, role: "member" | "administrator" = "member"): { human: Human; credential: string } {
    if (!queries.member(store, id)) queries.insertMember(store, { id, label: id, role, status: "active", revision: 0,
      created: ctx.now(), appliedStatus: null, appliedRevision: null, lastSuccess: null, error: null });
    const credential = secret();
    queries.insertSession(store, { hash: hash(credential), member: id, token: "native-token", csrf: "csrf", expires: ctx.now() + 60_000 });
    return { human: { id, sessionHash: hash(credential) }, credential };
  }
  return { ctx, member };
}

test('wake policy defaults to owner, resolves active verified identities and keeps delegation revisions separate', () => {
  const { ctx, member } = fixture();
  try {
    const admin = member(ctx.config.administrator).human;
    const alice = member('@alice:tests.localhost').human;
    const bob = member('@bob:tests.localhost').human;
    function enroll(owner: Human, name: string) {
      const request = value(requestEnrollment(ctx, { owner: owner.id, name })) as { id: string; code: string };
      const decision = value(decide(ctx, owner, request.id, { decision: 'approve', code: request.code })) as { agent: string };
      return queries.agent(ctx.store, decision.agent)!;
    }
    const agent = enroll(alice, 'main'), peer = enroll(alice, 'peer'), foreign = enroll(bob, 'foreign');
    const current = () => queries.agent(ctx.store, agent.id)!;
    const senders = () => value(deliveryPolicy(deliverySettings(ctx, current()))).senders;
    const change = (wakePolicy: string) => value(changeAgent(ctx, alice, agent.id, { revision: current().revision, wakePolicy }));
    assert.equal(current().wakePolicy, 'owner'); assert.deepEqual(senders(), [alice.id]);
    assert.equal(changeAgent(ctx, bob, agent.id, { revision: 0, wakePolicy: 'everyone' }).ok, false);
    assert.equal(changeAgent(ctx, admin, agent.id, { revision: 0, wakePolicy: 'everyone' }).ok, false);
    for (const wakePolicy of ['all', '', null, 1]) assert.equal(changeAgent(ctx, alice, agent.id, { revision: 0, wakePolicy }).ok, false);
    change('owner-agents'); assert.deepEqual(senders(), [alice.id, peer.userId].sort());
    assert.equal(changeAgent(ctx, alice, agent.id, { revision: 0, wakePolicy: 'everyone' }).ok, false);
    change('humans'); assert.deepEqual(senders(), [alice.id, peer.userId, bob.id, admin.id].sort());
    change('everyone'); assert.deepEqual(senders(), [alice.id, peer.userId, bob.id, admin.id, foreign.userId].sort());
    assert.equal(current().grantRevision, agent.grantRevision); assert.equal(current().grants, agent.grants);
    assert.equal(current().appliedGrantRevision, agent.appliedGrantRevision);
    value(changeAgent(ctx, alice, peer.id, { revision: 0, status: 'suspended' }));
    assert(!senders().includes(peer.userId));
    value(changeMember(ctx, admin, bob.id, { revision: 0, status: 'suspended' }));
    assert(!senders().includes(bob.id)); assert(!senders().includes(foreign.userId));
    assert.deepEqual(senders(), [alice.id, admin.id].sort());
    value(changeAgent(ctx, admin, agent.id, { revision: current().revision, wakePolicy: 'owner' }));
    assert.deepEqual(senders(), [alice.id]);
    const record = queries.audit(ctx.store, alice.id, true, Number.MAX_SAFE_INTEGER).find(entry => entry.target === agent.id);
    assert.equal(JSON.parse(record!.detail).wakePolicy, 'owner');
    value(changeMember(ctx, admin, alice.id, { revision: 0, status: 'suspended' }));
    assert.deepEqual(senders(), []);
    assert.equal(changeAgent(ctx, alice, agent.id, { revision: current().revision, wakePolicy: 'everyone' }).ok, false);
  } finally { ctx.native.close(); ctx.store.close(); }
});

test('only current system administrators can save or reset revisioned onboarding instructions', () => {
  const { ctx, member } = fixture();
  try {
    const admin = member(ctx.config.administrator).human;
    const alice = member('@alice:tests.localhost').human;
    const deputy = member('@deputy:tests.localhost', 'administrator').human;
    const initial = queries.readPolicy(ctx.store)!;
    const updated = { ...initial, agentInstructions: 'Use project tickets.\nNever include credentials.' };
    assert.equal(changePolicy(ctx, alice, updated).ok, false);
    assert.equal(changePolicy(ctx, { id: '@agent-test:tests.localhost', sessionHash: admin.sessionHash }, updated).ok, false);
    value(changePolicy(ctx, admin, updated));
    assert.deepEqual(queries.readPolicy(ctx.store), { ...updated, revision: initial.revision + 1 });
    assert.equal(changePolicy(ctx, admin, { ...initial, agentInstructions: 'Stale overwrite' }).ok, false);
    value(changeMember(ctx, admin, deputy.id, { revision: 0, role: 'member' }));
    assert.equal(changePolicy(ctx, deputy, queries.readPolicy(ctx.store)).ok, false);
    value(changeMember(ctx, admin, deputy.id, { revision: 1, role: 'administrator', status: 'suspended' }));
    assert.equal(changePolicy(ctx, deputy, queries.readPolicy(ctx.store)).ok, false);
    value(changePolicy(ctx, admin, { ...queries.readPolicy(ctx.store), agentInstructions: '' }));
    assert.deepEqual(queries.readPolicy(ctx.store), { ...initial, revision: initial.revision + 2 });
    const audit = queries.audit(ctx.store, admin.id, true, Number.MAX_SAFE_INTEGER).filter(item => item.action === 'policy.change');
    assert.equal(audit.length, 2);
    assert.equal(JSON.parse(audit[0]!.detail).agentInstructions, '');
    assert.equal(JSON.parse(audit[1]!.detail).agentInstructions, updated.agentInstructions);
  } finally { ctx.native.close(); ctx.store.close(); }
});

test("published Tinqer parameters and SQLite transactions preserve deny-all enrollment", () => {
  const { ctx, member } = fixture();
  const owner = member("@alice:tests.localhost").human;
  const other = member("@bob:tests.localhost").human;
  const request = value(requestEnrollment(ctx, { owner: owner.id, name: "Holmes" })) as { id: string; code: string; secret: string };
  assert.equal(decide(ctx, other, request.id, { decision: "approve", code: request.code }).ok, false);
  const decision = value(decide(ctx, owner, request.id, { decision: "approve", code: request.code })) as { agent: string };
  assert.equal(decide(ctx, owner, request.id, { decision: "approve", code: request.code }).ok, false);
  const agent = queries.agent(ctx.store, decision.agent)!;
  assert.deepEqual(JSON.parse(agent.grants), []);
  assert.equal(agent.token, null);
  assert.equal(agent.grantRevision, 0);
  assert.equal(exchange(ctx, request.id, { secret: "wrong" }).ok, false);
  assert.equal((value(exchange(ctx, request.id, { secret: request.secret })) as { status: string }).status, "provisioning");
  const before = queries.agents(ctx.store, "", true).length;
  assert.throws(() => ctx.store.transaction(() => { queries.insertAgent(ctx.store, { ...agent, id: secret(), userId: "@rollback:tests.localhost" }); throw Error("rollback"); }).immediate());
  assert.equal(queries.agents(ctx.store, "", true).length, before);
  ctx.store.close();
});

test("actor demotion, suspension and logout invalidate existing principals at mutations", async () => {
  const { ctx, member } = fixture();
  const admin = member(ctx.config.administrator).human;
  const alice = member("@alice:tests.localhost", "administrator");
  value(createInvitation(ctx, alice.human, { role: "member", expiresSeconds: 60 }));
  value(changeMember(ctx, admin, alice.human.id, { revision: 0, role: "member" }));
  assert.equal(createInvitation(ctx, alice.human, { role: "administrator", expiresSeconds: 60 }).ok, false);
  let proceed!: (result: Result<string>) => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const native = { ...ctx.native, identify: async () => { started(); return new Promise<Result<string>>(resolve => { proceed = resolve; }); } };
  const race: Context = { ...ctx, native };
  const pending = authenticate(race, alice.credential);
  await waiting;
  value(changeMember(ctx, admin, alice.human.id, { revision: 1, status: "suspended" }));
  proceed(success(alice.human.id));
  assert.equal((await pending).ok, false);
  value(changeMember(ctx, admin, alice.human.id, { revision: 2, status: "active" }));
  const logout = authenticate(race, alice.credential);
  value(endSession(ctx, alice.credential));
  proceed(success(alice.human.id));
  assert.equal((await logout).ok, false);
  assert.equal(createInvitation(ctx, alice.human, { role: "member", expiresSeconds: 60 }).ok, false);
  ctx.store.close();
});

test("name and mute edits retain the access-grant revision", async () => {
  const { ctx, member } = fixture();
  const owner = member("@alice:tests.localhost").human;
  const admin = member(ctx.config.administrator).human;
  const request = value(requestEnrollment(ctx, { owner: owner.id, name: "Holmes" })) as { id: string; code: string };
  const decision = value(decide(ctx, owner, request.id, { decision: "approve", code: request.code })) as { agent: string };
  const agent = queries.agent(ctx.store, decision.agent)!;
  const grant = [{ room: "!native", access: "read" as const, muted: false }];
  queries.changeAgent(ctx.store, agent.id, 0, "active", null, JSON.stringify(grant), 1, agent.wakePolicy);
  queries.application(ctx.store, agent.id, 1, { token: "native", applied: JSON.stringify(grant), appliedRevision: 1,
    appliedGrantRevision: 1, lastSuccess: Date.now(), error: null });
  value(changeAgent(ctx, admin, agent.id, { revision: 1, name: "Detective" }));
  assert.equal(queries.agent(ctx.store, agent.id)!.grantRevision, 1);
  value(await changeGrants(ctx, owner, agent.id, { revision: 2, grants: [{ ...grant[0], muted: true }] }));
  assert.equal(queries.agent(ctx.store, agent.id)!.grantRevision, 1);
  assert.equal(changeAgent(ctx, owner, agent.id, { revision: 3, name: "Unauthorized" }).ok, false);
  ctx.store.close();
});

test("future revisions cannot overwrite a concurrent permanent revocation", async scope => {
  const { ctx, member } = fixture();
  const owner = member("@alice:tests.localhost").human;
  const admin = member(ctx.config.administrator).human;
  const request = value(requestEnrollment(ctx, { owner: owner.id, name: "Holmes" })) as { id: string; code: string };
  const decision = value(decide(ctx, owner, request.id, { decision: "approve", code: request.code })) as { agent: string };
  const reads: string[] = [];
  const server = createServer((request, response) => {
    reads.push(request.url!);
    const result = request.url!.endsWith("/joined_rooms") ? { joined_rooms: ["!native"] }
      : request.url!.includes("/m.room.member/") ? { membership: "join" }
      : request.url!.endsWith("/m.room.power_levels") ? { users: { [owner.id]: 100 }, events_default: 0,
        state_default: 100, invite: 100, kick: 100, ban: 100, redact: 100 }
      : [{ type: "m.room.create", sender: owner.id, state_key: "", content: { room_version: "12" } }];
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  scope.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  let nativeCalls = 0;
  let resume!: (result: Result<Native>) => void;
  const race: Context = { ...ctx, native: { ...ctx.native, asUser: async () => {
    nativeCalls++;
    return new Promise<Result<Native>>(resolve => { resume = resolve; });
  } } };
  const premature = await changeGrants(race, owner, decision.agent, { revision: 1, grants: [{ room: "!native", access: "reply", muted: false }] });
  assert.equal(premature.ok, false);
  if (!premature.ok) assert.equal(premature.error.code, "conflict");
  assert.equal(nativeCalls, 0);
  const pending = changeGrants(race, owner, decision.agent, { revision: 0, grants: [{ room: "!native", access: "reply", muted: false }] });
  assert.equal(nativeCalls, 1);
  value(changeAgent(ctx, admin, decision.agent, { revision: 0, status: "revoked" }));
  resume(success({ base: "http://127.0.0.1:" + address.port }));
  const outcome = await pending;
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.error.code, "conflict");
  assert.equal(reads.length, 4);
  assert.equal(queries.agent(ctx.store, decision.agent)!.status, "revoked");
  assert.equal(queries.agent(ctx.store, decision.agent)!.revision, 1);
  ctx.store.close();
});
