import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { conduitFixture } from "../scripts/architecture-proof/conduit-fixture.js";
import { openStore } from "../apps/server/src/data/database.js";
import * as queries from "../apps/server/src/data/queries.js";
import { context, secret, type Human } from "../apps/server/src/context.js";
import { acceptInvitation, authenticate, createSession } from "../apps/server/src/sessions.js";
import { changeAgent, changeGrants, changeMember, createInvitation } from "../apps/server/src/management.js";
import { decide, exchange, requestEnrollment } from "../apps/server/src/enrollment.js";
import { reconcileAgent } from "../apps/server/src/reconcile.js";
import { serviceUser } from "../apps/server/src/config.js";
import { API, nativeOk, nativeRequest, segment, type Native } from "../packages/matrix/src/http.js";
import { joined } from "../apps/server/src/rooms.js";
import { agentRooms } from '../apps/server/src/agent-rooms.js';
import type { Result } from "../packages/kernel/src/result.js";

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? "" : result.error.message);
  return result.value;
}

test("management core applies and verifies direct native authority", { timeout: 180_000 }, async scope => {
  const jwtSecret = secret();
  const fixture = await conduitFixture(scope, { jwtSecret });
  const service = await fixture.register("crossfire-tests");
  const admin = await fixture.register("admin");
  const store = openStore(":memory:");
  scope.after(() => store.close());
  const ctx = context(store, { instance: "tests", serverName: "architecture.localhost", publicOrigin: "http://127.0.0.1",
    matrixOrigin: fixture.base, administrator: admin.id, registrationSecret: fixture.registrationToken, jwtSecret });
  scope.after(() => ctx.native.close());
  assert.equal(serviceUser(ctx.config), service.id);
  const adminLogin = value(await createSession(ctx, { token: admin.token }));
  const adminHuman = value(await authenticate(ctx, adminLogin.credential)).human;
  let owner: Human;
  let ownerAccount: { user_id: string; access_token: string };
  await scope.test("human invitation creates one native identity without storing a password", async () => {
    const invite = value(createInvitation(ctx, adminHuman, { role: "member", expiresSeconds: 600 })) as { id: string; secret: string };
    const input = { secret: invite.secret, username: "alice", password: secret(), label: "Alice" };
    const accepted = value(await acceptInvitation(ctx, invite.id, input)) as { member: string; account: { user_id: string; access_token: string } };
    ownerAccount = accepted.account;
    const second = value(await acceptInvitation(ctx, invite.id, input)) as { member: string };
    assert.equal(second.member, accepted.member);
    assert.equal(queries.members(store).length, 2);
    assert.equal(JSON.stringify(queries.invitations(store)).includes(input.password), false);
    assert.deepEqual(value(await joined({ base: fixture.base, token: ownerAccount.access_token })), []);
    const session = value(await createSession(ctx, { token: ownerAccount.access_token }));
    owner = value(await authenticate(ctx, session.credential)).human;
  });
  assert(owner! && ownerAccount!);
  const serviceClient: Native = { base: fixture.base, token: service.token };
  const created = value(await nativeOk(serviceClient, "POST", API + "/createRoom", {
    preset: "private_chat", initial_state: [{ type: "m.room.history_visibility", state_key: "", content: { history_visibility: "joined" } }],
    power_level_content_override: { users: { [owner!.id]: 100 }, users_default: 0,
      events_default: 0, state_default: 100, invite: 100, kick: 100, ban: 100, redact: 100 },
  }));
  assert.equal(typeof created.room_id, "string");
  const room = created.room_id as string;
  const path = API + "/rooms/" + segment(room);
  value(await nativeOk(serviceClient, "POST", path + "/invite", { user_id: owner!.id }));
  value(await nativeOk({ base: fixture.base, token: ownerAccount!.access_token }, "POST", path + "/join", {}));
  const request = value(requestEnrollment(ctx, { owner: owner!.id, name: "Holmes" })) as { id: string; code: string; secret: string };
  const approved = value(decide(ctx, owner!, request.id, { decision: "approve", code: request.code })) as { agent: string };
  const agentId = approved.agent;
  let client: Native;
  await scope.test("agent approval provisions a zero-room identity and only its initiating secret exchanges it", async () => {
    value(await reconcileAgent(ctx, agentId));
    assert.equal(exchange(ctx, request.id, { secret: "bad" }).ok, false);
    const ready = value(exchange(ctx, request.id, { secret: request.secret })) as { account: { access_token: string } };
    client = { base: fixture.base, token: ready.account.access_token };
    assert.deepEqual(value(await joined(client)), []);
    assert.equal((await createSession(ctx, { token: ready.account.access_token })).ok, false);
    assert.equal(value(await nativeRequest(client, "POST", path + "/join", {})).status, 403);
  });
  assert(client!);
  await scope.test('Element-style native member permissions allow replies; custom levels respect the owner ceiling', async () => {
    const original = value(await nativeOk(serviceClient, 'GET', path + '/state/m.room.power_levels'));
    value(await nativeOk(serviceClient, 'PUT', path + '/state/m.room.power_levels', {
      ...original, invite: 0, events: { 'org.matrix.msc3401.call.member': 0, 'm.room.name': 50 },
    }));
    value(await nativeOk(serviceClient, 'PUT', path + '/state/m.room.name', { name: 'Options Analysis' }));
    const nativeRoom = value(await agentRooms(ctx, owner!, agentId)).find(item => item.id === room)!;
    assert.equal(nativeRoom.name, 'Options Analysis');
    assert.equal(nativeRoom.replyLevel, 0);
    value(await changeGrants(ctx, owner!, agentId, { revision: queries.agent(store, agentId)!.revision, grants: [{ room, access: 'reply', muted: false }] }));
    value(await reconcileAgent(ctx, agentId));
    value(await nativeOk(client!, 'PUT', path + '/send/m.room.message/normal-member', { msgtype: 'm.text', body: 'Reply works with native invite/call permissions' }));
    assert.equal((await changeGrants(ctx, owner!, agentId, { revision: queries.agent(store, agentId)!.revision,
      grants: [{ room, access: 'custom', level: 101, muted: false }] })).ok, false);
    value(await changeGrants(ctx, owner!, agentId, { revision: queries.agent(store, agentId)!.revision,
      grants: [{ room, access: 'custom', level: 50, muted: false }] }));
    value(await reconcileAgent(ctx, agentId));
    value(await nativeOk(client!, 'PUT', path + '/state/m.room.name', { name: 'Agent-authorized room name' }));
    const power = value(await nativeOk(serviceClient, 'GET', path + '/state/m.room.power_levels'));
    assert.equal(power.invite, 0, 'Granting must not rewrite room-wide permissions');
    assert.deepEqual(power.events, { 'org.matrix.msc3401.call.member': 0, 'm.room.name': 50 });
    value(await changeGrants(ctx, owner!, agentId, { revision: queries.agent(store, agentId)!.revision, grants: [] }));
    value(await reconcileAgent(ctx, agentId));
    value(await nativeOk(serviceClient, 'PUT', path + '/state/m.room.power_levels', original));
  });
  await scope.test("ordinary humans and enrolled agents can create rooms without gaining access to other private rooms", async () => {
    for (const creator of [{ base: fixture.base, token: ownerAccount!.access_token }, client!]) {
      const created = value(await nativeOk(creator, "POST", API + "/createRoom", {
        name: "Public collaboration", visibility: "public", preset: "public_chat",
      }));
      assert.equal(typeof created.room_id, "string");
      const createdPath = API + "/rooms/" + segment(created.room_id as string);
      const rules = value(await nativeOk(creator, "GET", createdPath + "/state/m.room.join_rules"));
      assert.equal(rules.join_rule, "public");
      value(await nativeOk(creator, "POST", createdPath + "/leave", {}));
    }
    assert.deepEqual(value(await joined(client!)), []);
    assert.equal(value(await nativeRequest(client!, "POST", path + "/join", {})).status, 403);
  });
  await scope.test("fresh read-only grant denies default arbitrary events below higher explicit message thresholds", async () => {
    const powers = value(await nativeOk(serviceClient, "GET", path + "/state/m.room.power_levels"));
    value(await nativeOk(serviceClient, "PUT", path + "/state/m.room.power_levels", {
      ...powers, events: { "m.room.message": 50, "m.reaction": 50 },
    }));
    value(await changeGrants(ctx, owner!, agentId, { revision: queries.agent(store, agentId)!.revision,
      grants: [{ room, access: "read", muted: false }] }));
    value(await reconcileAgent(ctx, agentId));
    assert.deepEqual(value(await joined(client!)), [room]);
    assert.equal(value(await nativeRequest(client!, "PUT", path + "/send/m.room.message/denied", { msgtype: "m.text", body: "no" })).status, 403);
    assert.equal(value(await nativeRequest(client!, "PUT", path + "/send/m.reaction/denied", { "m.relates_to": { rel_type: "m.annotation", event_id: "$unknown", key: "x" } })).status, 403);
    assert.equal(value(await nativeRequest(client!, "POST", path + "/invite", { user_id: admin.id })).status, 403);
    const positive = value(await nativeOk(serviceClient, "PUT", path + "/send/m.room.message/positive", { msgtype: "m.text", body: "readable" }));
    value(await nativeOk(client!, "GET", path + "/event/" + segment(positive.event_id as string)));
    const applied = value(await nativeOk(serviceClient, "GET", path + "/state/m.room.power_levels"));
    assert.equal((applied.users as Record<string, unknown>)[queries.agent(store, agentId)!.userId], -1);
    assert.equal(value(await nativeRequest(client!, "PUT", path + "/send/org.crossfire.review/denied", { arbitrary: "content" })).status, 403);
    const arbitrary = value(await nativeOk(serviceClient, "PUT", path + "/send/org.crossfire.review/positive", { arbitrary: "content" }));
    value(await nativeOk(client!, "GET", path + "/event/" + segment(arbitrary.event_id as string)));
    value(await nativeOk(serviceClient, "PUT", path + "/state/m.room.power_levels", powers));
  });
  await scope.test("reply is explicit; rename and mute do not rejoin a kicked room", async () => {
    value(await changeGrants(ctx, owner!, agentId, { revision: queries.agent(store, agentId)!.revision,
      grants: [{ room, access: "reply", muted: false }] }));
    value(await reconcileAgent(ctx, agentId));
    value(await nativeOk(client!, "PUT", path + "/send/m.room.message/allowed", { msgtype: "m.text", body: "allowed" }));
    value(await nativeOk(serviceClient, "POST", path + "/kick", { user_id: queries.agent(store, agentId)!.userId }));
    value(changeAgent(ctx, adminHuman, agentId, { revision: queries.agent(store, agentId)!.revision, name: "Detective" }));
    value(await changeGrants(ctx, owner!, agentId, { revision: queries.agent(store, agentId)!.revision,
      grants: [{ room, access: "reply", muted: true }] }));
    value(await reconcileAgent(ctx, agentId));
    assert.deepEqual(value(await joined(client!)), []);
    assert.deepEqual(JSON.parse(queries.agent(store, agentId)!.grants), []);
  });
  await scope.test("owner removal narrows the durable grant and never restores it automatically", async () => {
    value(await changeGrants(ctx, owner!, agentId, { revision: queries.agent(store, agentId)!.revision,
      grants: [{ room, access: "reply", muted: false }] }));
    value(await reconcileAgent(ctx, agentId));
    value(await nativeOk(serviceClient, "POST", path + "/kick", { user_id: owner!.id }));
    value(await reconcileAgent(ctx, agentId));
    assert.deepEqual(value(await joined(client!)), []);
    assert.deepEqual(JSON.parse(queries.agent(store, agentId)!.grants), []);
    value(await nativeOk(serviceClient, "POST", path + "/invite", { user_id: owner!.id }));
    value(await nativeOk({ base: fixture.base, token: ownerAccount!.access_token }, "POST", path + "/join", {}));
    value(await reconcileAgent(ctx, agentId));
    assert.deepEqual(value(await joined(client!)), []);
  });
  await scope.test("trusted native administrative revocation disables the real old client token", async () => {
    const formerToken = client!.token!;
    const probePassword = "crossfire-deactivation-probe";
    const challenge = value(await nativeRequest(client!, "POST", API + "/account/password", { new_password: probePassword }));
    assert.equal(challenge.status, 401);
    const account = queries.agent(store, agentId)!;
    value(await nativeOk(client!, "POST", API + "/account/password", { new_password: probePassword,
      logout_devices: false, auth: { type: "m.login.password", session: challenge.body.session,
        identifier: { type: "m.id.user", user: account.userId }, password: account.password } }));
    const probe = value(await nativeOk({ base: fixture.base }, "POST", API + "/login", {
      type: "m.login.password", identifier: { type: "m.id.user", user: account.userId }, password: probePassword,
    }));
    value(await nativeOk({ base: fixture.base, token: probe.access_token as string }, "POST", API + "/logout", {}));
    value(changeAgent(ctx, owner!, agentId, { revision: queries.agent(store, agentId)!.revision, status: "revoked" }));
    value(await reconcileAgent(ctx, agentId));
    assert.equal(value(await nativeRequest({ base: fixture.base, token: formerToken }, "GET", API + "/account/whoami")).status, 401);
    assert.equal(queries.agent(store, agentId)!.token, null);
    const login = value(await nativeRequest({ base: fixture.base }, "POST", API + "/login", {
      type: "m.login.password", identifier: { type: "m.id.user", user: account.userId }, password: probePassword,
    }));
    assert.equal(login.status, 403);
    assert.equal(login.body.errcode, "M_USER_DEACTIVATED");
    value(await reconcileAgent(ctx, agentId));
    assert.equal(queries.agents(store, "", true).length, 1);
  });
  await scope.test("member revocation is guarded by current management authority", () => {
    assert.equal(changeMember(ctx, adminHuman, admin.id, { revision: 0, status: "revoked" }).ok, false);
    assert.equal(changeMember(ctx, owner!, admin.id, { revision: 0, status: "revoked" }).ok, false);
    assert.equal(requestEnrollment(ctx, { owner: "@outsider:architecture.localhost", name: randomUUID() }).ok, false);
  });
});
