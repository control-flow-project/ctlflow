import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { nativeApplication } from './support/native-application.js';
import { value, secret } from './support/application.js';
import { createSession } from '@ctlflow/crossfire-domain/session/create-session';
import { acceptMemberInvitation } from '@ctlflow/crossfire-domain/member/accept-invitation';
import { changeMember } from '@ctlflow/crossfire-domain/member/change-member';
import { changeAgent } from '@ctlflow/crossfire-domain/agent/change-agent';
import { deliveryPolicy } from '@ctlflow/crossfire-domain/agent/delivery-policy';
import { changeRoomGrant } from '@ctlflow/crossfire-domain/room-access/change-grant';
import { reconcileRoomGrant } from '@ctlflow/crossfire-domain/room-access/reconcile-grant';
import { reconcilePrincipal } from '@ctlflow/crossfire-domain/principal/reconcile';
import { connectOwnerConversation } from '@ctlflow/crossfire-domain/owner-conversation/connect';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { readRoom } from '@ctlflow/crossfire-domain/room/read-room';
import { API, segment } from '@ctlflow/crossfire-adapter-matrix/protocol';
import { nativeOk, nativeRequest, type Native } from '@ctlflow/crossfire-adapter-matrix/http';
import { success } from '@ctlflow/crossfire-kernel/result';
import { defaultCoordinationPolicy } from '@ctlflow/crossfire-contracts/coordination-policy';

test("management core applies and verifies direct native authority", { timeout: 180_000 }, async scope => {
  const fixture = await nativeApplication(scope), { services, admin } = fixture;
  const owner = await fixture.member('alice'), ownerId = owner.member.principal.backendUserId;
  await scope.test("human invitation creates one native identity without storing a password", async () => {
    const resumed = value(await acceptMemberInvitation(services, owner.invitation.invitationId, owner.input, randomUUID(), { deviceId: 'RECOVERED_ELEMENT_DEVICE' }));
    assert.equal(resumed.memberId, owner.accepted.memberId);
    assert.equal(resumed.account.userId, owner.accepted.account.userId);
    assert.equal(value(await services.messaging.identify(resumed.account.accessToken)), ownerId);
    assert(!JSON.stringify(value(services.repositories.memberInvitation.find({ id: owner.invitation.invitationId }))).includes(owner.input.password));
    assert.deepEqual(value(await nativeOk({ base: fixture.native.base, token: owner.token }, "GET", API + "/joined_rooms")).joined_rooms, []);
  });
  const serviceClient: Native = { base: fixture.native.base, token: fixture.service.token };
  const created = value(await nativeOk(serviceClient, "POST", API + "/createRoom", {
    preset: "private_chat", initial_state: [{ type: "m.room.history_visibility", state_key: "", content: { history_visibility: "joined" } }],
    power_level_content_override: { users: { [ownerId]: 100 }, users_default: 0,
      events_default: 0, state_default: 100, invite: 100, kick: 100, ban: 100, redact: 100 },
  }));
  assert.equal(typeof created.room_id, "string");
  const room = created.room_id as string;
  const path = API + "/rooms/" + segment(room);
  value(await nativeOk(serviceClient, "POST", path + "/invite", { user_id: ownerId }));
  value(await nativeOk({ base: fixture.native.base, token: owner.token }, "POST", path + "/join", {}));
  const agent = await fixture.agent(owner.actor, 'holmes'), agentId = agent.id;
  assert.equal(value(services.repositories.ownerConversation.find({ agentId })), null);
  assert.deepEqual(value(await services.messaging.joined(agent.backendUserId)), []);
  value(await connectOwnerConversation(services, agent.actor, agentId));
  const ownerRoom = value(services.repositories.ownerConversation.find({ agentId }))!.roomId;
  const current = () => value(services.directory.agent(agentId))!;
  async function grant(accessMode: 'read' | 'reply' | 'custom' | 'none', powerLevel: number | null = null, muted = false) {
    return changeRoomGrant(services, owner.actor, { agentId, roomId: room, expectedRevision: current().principal.revision,
      expectedGeneration: value(services.repositories.agentRoomGrant.find({ agentId, roomId: room }))?.generation ?? null, accessMode, nativeAccess: powerLevel === null ? null : { powerLevel }, muted }, randomUUID());
  }
  async function reconcile() { value(await reconcilePrincipal(services, agentId)); return reconcileRoomGrant(services, agentId, room); }
  const joined = async (client: Native) => { const response = await nativeOk(client, "GET", API + "/joined_rooms"); return response.ok ? success(response.value.joined_rooms) : response; };
  const client: Native = { base: fixture.native.base, token: agent.token };
  await scope.test("first private owner contact establishes only its owner DM and only its initiating secret exchanges identity", async () => {
    assert.equal(exchangeEnrollment(services, agent.input.enrollmentId, "bad").ok, false);
    assert.deepEqual(value(await joined(client)), [ownerRoom]);
    assert.equal((await createSession(services, agent.token)).ok, false);
    assert.equal(value(await nativeRequest(client, "POST", path + "/join", {})).status, 403);
  });
  assert(client!);
  await scope.test('Element-style native member permissions allow replies; custom levels respect the owner ceiling', async () => {
    const original = value(await nativeOk(serviceClient, 'GET', path + '/state/m.room.power_levels'));
    value(await nativeOk(serviceClient, 'PUT', path + '/state/m.room.power_levels', {
      ...original, invite: 0, events: { 'org.matrix.msc3401.call.member': 0, 'm.room.name': 50 },
    }));
    value(await nativeOk(serviceClient, 'PUT', path + '/state/m.room.name', { name: 'Options Analysis' }));
    const nativeRoom = value(await readRoom(services, owner.actor, room, agentId));
    assert.equal(nativeRoom.name, 'Options Analysis');
    assert(nativeRoom.authority?.accessModes.includes('reply'));
    value(await grant('reply', null, false));
    value(await reconcile());
    value(await nativeOk(client!, 'PUT', path + '/send/m.room.message/normal-member', { msgtype: 'm.text', body: 'Reply works with native invite/call permissions' }));
    assert.equal((await grant('custom', 101)).ok, false);
    value(await grant('custom', 50));
    value(await reconcile());
    value(await nativeOk(client!, 'PUT', path + '/state/m.room.name', { name: 'Agent-authorized room name' }));
    const power = value(await nativeOk(serviceClient, 'GET', path + '/state/m.room.power_levels'));
    assert.equal(power.invite, 0, 'Granting must not rewrite room-wide permissions');
    assert.deepEqual(power.events, { 'org.matrix.msc3401.call.member': 0, 'm.room.name': 50 });
    value(await grant('none'));
    value(await reconcile());
    value(await nativeOk(serviceClient, 'PUT', path + '/state/m.room.power_levels', original));
  });
  await scope.test("ordinary humans and enrolled agents can create rooms without gaining access to other private rooms", async () => {
    for (const creator of [{ base: fixture.native.base, token: owner.token }, client!]) {
      const created = value(await nativeOk(creator, "POST", API + "/createRoom", {
        name: "Public collaboration", visibility: "public", preset: "public_chat",
      }));
      assert.equal(typeof created.room_id, "string");
      const createdPath = API + "/rooms/" + segment(created.room_id as string);
      const rules = value(await nativeOk(creator, "GET", createdPath + "/state/m.room.join_rules"));
      assert.equal(rules.join_rule, "public");
      value(await nativeOk(creator, "POST", createdPath + "/leave", {}));
    }
    assert.deepEqual(value(await joined(client!)), [ownerRoom]);
    assert.equal(value(await nativeRequest(client!, "POST", path + "/join", {})).status, 403);
  });
  await scope.test("fresh read-only grant denies default arbitrary events below higher explicit message thresholds", async () => {
    const powers = value(await nativeOk(serviceClient, "GET", path + "/state/m.room.power_levels"));
    value(await nativeOk(serviceClient, "PUT", path + "/state/m.room.power_levels", {
      ...powers, events: { "m.room.message": 50, "m.reaction": 50 },
    }));
    value(await grant('read', null, false));
    value(await reconcile());
    assert.deepEqual((value(await joined(client!)) as string[]).sort(), [ownerRoom, room].sort());
    assert.equal(value(await nativeRequest(client!, "PUT", path + "/send/m.room.message/denied", { msgtype: "m.text", body: "no" })).status, 403);
    assert.equal(value(await nativeRequest(client!, "PUT", path + "/send/m.reaction/denied", { "m.relates_to": { rel_type: "m.annotation", event_id: "$unknown", key: "x" } })).status, 403);
    assert.equal(value(await nativeRequest(client!, "POST", path + "/invite", { user_id: admin.member.principal.backendUserId })).status, 403);
    const positive = value(await nativeOk(serviceClient, "PUT", path + "/send/m.room.message/positive", { msgtype: "m.text", body: "readable" }));
    value(await nativeOk(client!, "GET", path + "/event/" + segment(positive.event_id as string)));
    const applied = value(await nativeOk(serviceClient, "GET", path + "/state/m.room.power_levels"));
    assert.equal((applied.users as Record<string, unknown>)[agent.backendUserId], -1);
    assert.equal(value(await nativeRequest(client!, "PUT", path + "/send/org.crossfire.review/denied", { arbitrary: "content" })).status, 403);
    const arbitrary = value(await nativeOk(serviceClient, "PUT", path + "/send/org.crossfire.review/positive", { arbitrary: "content" }));
    value(await nativeOk(client!, "GET", path + "/event/" + segment(arbitrary.event_id as string)));
    value(await nativeOk(serviceClient, "PUT", path + "/state/m.room.power_levels", powers));
  });
  await scope.test("reply is explicit; account revision and mute edits do not rejoin a kicked room", async () => {
    value(await grant('reply', null, false));
    value(await reconcile());
    value(await nativeOk(client!, "PUT", path + "/send/m.room.message/allowed", { msgtype: "m.text", body: "allowed" }));
    value(await nativeOk(serviceClient, "POST", path + "/kick", { user_id: agent.backendUserId }));
    value(changeAgent(services, admin.actor, agentId, { expectedRevision: current().principal.revision, status: 'active' }, randomUUID()));
    value(await grant('reply', null, true));
    value(await reconcile());
    assert.deepEqual(value(await joined(client!)), [ownerRoom]);
    assert.deepEqual(value(deliveryPolicy(services, agent.actor, agentId)).grants.map(grant => grant.roomId), [ownerRoom]);
  });
  await scope.test("owner removal narrows the durable grant and never restores it automatically", async () => {
    value(await grant('reply', null, false));
    value(await reconcile());
    value(await nativeOk(serviceClient, "POST", path + "/kick", { user_id: ownerId }));
    value(await reconcile());
    assert.deepEqual(value(await joined(client!)), [ownerRoom]);
    assert.deepEqual(value(deliveryPolicy(services, agent.actor, agentId)).grants.map(grant => grant.roomId), [ownerRoom]);
    value(await nativeOk(serviceClient, "POST", path + "/invite", { user_id: ownerId }));
    value(await nativeOk({ base: fixture.native.base, token: owner.token }, "POST", path + "/join", {}));
    value(await reconcile());
    assert.deepEqual(value(await joined(client!)), [ownerRoom]);
  });
  await scope.test("trusted native administrative revocation disables the real old client token", async () => {
    const formerToken = client!.token!;
    const probePassword = "crossfire-deactivation-probe";
    const challenge = value(await nativeRequest(client!, "POST", API + "/account/password", { new_password: probePassword }));
    assert.equal(challenge.status, 401);
    const account = { userId: agent.backendUserId, password: value(services.repositories.agentCredential.find({ agentId }))!.provisioningPassword };
    value(await nativeOk(client!, "POST", API + "/account/password", { new_password: probePassword,
      logout_devices: false, auth: { type: "m.login.password", session: challenge.body.session,
        identifier: { type: "m.id.user", user: account.userId }, password: account.password } }));
    const probe = value(await nativeOk({ base: fixture.native.base }, "POST", API + "/login", {
      type: "m.login.password", identifier: { type: "m.id.user", user: account.userId }, password: probePassword,
    }));
    value(await nativeOk({ base: fixture.native.base, token: probe.access_token as string }, "POST", API + "/logout", {}));
    value(changeAgent(services, owner.actor, agentId, { expectedRevision: current().principal.revision, status: "revoked" }, randomUUID()));
    value(await reconcile());
    assert.equal(value(await nativeRequest({ base: fixture.native.base, token: formerToken }, "GET", API + "/account/whoami")).status, 401);
    assert.equal(value(services.repositories.agentCredential.find({ agentId }))?.accessToken ?? null, null);
    const login = value(await nativeRequest({ base: fixture.native.base }, "POST", API + "/login", {
      type: "m.login.password", identifier: { type: "m.id.user", user: account.userId }, password: probePassword,
    }));
    assert.equal(login.status, 403);
    assert.equal(login.body.errcode, "M_USER_DEACTIVATED");
    value(await reconcile());
    assert.equal(value(services.directory.agentIds(owner.actor.principalId)).length, 1);
  });
  await scope.test("member revocation is guarded by current management authority", async () => {
    assert.equal(changeMember(services, admin.actor, admin.actor.principalId, { expectedRevision: 0, status: "revoked" }, randomUUID()).ok, false);
    assert.equal(changeMember(services, owner.actor, admin.actor.principalId, { expectedRevision: 0, status: "revoked" }, randomUUID()).ok, false);
    assert.equal((await introduceEnrollment(services, { enrollmentId: randomUUID(), claimSecret: secret(), ownerBackendUserId: "@outsider:architecture.localhost",
      fleetKey: 'unknown-owner-fleet', controller: { name: 'Unknown owner controller' },
      instances: [{ instanceKey: "unknown", name: "unknown", coordinationPolicy: defaultCoordinationPolicy('@outsider:architecture.localhost') }] })).ok, false);
  });
});
