import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { conduitFixture } from "./conduit-fixture.js";
import { object, request, requestBytes, string } from "./native-http.js";

test("native admission and applied revocation boundaries", { timeout: 180_000 }, async context => {
  const fixture = await conduitFixture(context);
  const admin = await fixture.register("access-admin");
  const agent = await fixture.register("access-agent");
  const outsider = await fixture.register("no-rooms");
  const created = await request(fixture.base, "POST", "/_matrix/client/v3/createRoom", {
    preset: "private_chat",
    initial_state: [{ type: "m.room.history_visibility", state_key: "", content: { history_visibility: "joined" } }],
  }, admin.token);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const room = string(created.body.room_id);
  const path = "/_matrix/client/v3/rooms/" + encodeURIComponent(room);

  await context.test("missing registration authority cannot be replaced by a dummy stage", async () => {
    const input = { username: "unapproved", password: randomUUID() };
    const challenge = await request(fixture.base, "POST", "/_matrix/client/v3/register", input);
    assert.equal(challenge.status, 401);
    const attempted = await request(fixture.base, "POST", "/_matrix/client/v3/register", {
      ...input, auth: { type: "m.login.dummy", session: string(challenge.body.session) },
    });
    assert.equal(attempted.status, 401);
    assert.equal(attempted.body.access_token, undefined);
  });

  await context.test("roomless agent has only accepted creation metadata, not membership or private content", async () => {
    const joined = await request(fixture.base, "GET", "/_matrix/client/v3/joined_rooms", undefined, outsider.token);
    assert.deepEqual(joined.body.joined_rooms, []);
    const join = await request(fixture.base, "POST", path + "/join", {}, outsider.token);
    assert.equal(join.status, 403);
    const history = await request(fixture.base, "GET", path + "/messages?dir=b&limit=10", undefined, outsider.token);
    assert.equal(history.status, 200);
    assert(Array.isArray(history.body.chunk));
    assert.equal(history.body.chunk.length, 1);
    const creation = object(history.body.chunk[0]);
    assert.equal(creation.type, "m.room.create");
    assert.equal(creation.sender, admin.id);
    assert.equal(object(creation.content).room_version, "12");
    assert(Array.isArray(history.body.state));
    assert.equal(history.body.state.length, 1);
    const creatorProfile = object(history.body.state[0]);
    assert.equal(creatorProfile.type, "m.room.member");
    assert.equal(creatorProfile.sender, admin.id);
    assert.equal(creatorProfile.state_key, admin.id);
    assert.equal(object(creatorProfile.content).membership, "join");
  });

  await context.test("public and private room creation is available to authenticated accounts, not anonymous callers", async () => {
    const anonymous = await request(fixture.base, "POST", "/_matrix/client/v3/createRoom", {
      visibility: "public", preset: "public_chat",
    });
    assert.equal(anonymous.status, 401);
    for (const creator of [agent, outsider]) {
      for (const visibility of ["public", "private"] as const) {
        const created = await request(fixture.base, "POST", "/_matrix/client/v3/createRoom", {
          visibility, preset: visibility === "public" ? "public_chat" : "private_chat",
        }, creator.token);
        assert.equal(created.status, 200, JSON.stringify(created.body));
        const createdPath = "/_matrix/client/v3/rooms/" + encodeURIComponent(string(created.body.room_id));
        const rules = await request(fixture.base, "GET", createdPath + "/state/m.room.join_rules", undefined, creator.token);
        assert.equal(rules.status, 200);
        assert.equal(rules.body.join_rule, visibility === "public" ? "public" : "invite");
        const left = await request(fixture.base, "POST", createdPath + "/leave", {}, creator.token);
        assert.equal(left.status, 200);
      }
    }
    assert.deepEqual((await request(fixture.base, "GET", "/_matrix/client/v3/joined_rooms", undefined, outsider.token)).body.joined_rooms, []);
  });

  const invite = await request(fixture.base, "POST", path + "/invite", { user_id: agent.id }, admin.token);
  assert.equal(invite.status, 200);
  const join = await request(fixture.base, "POST", path + "/join", {}, agent.token);
  assert.equal(join.status, 200);
  const before = await request(fixture.base, "PUT", path + "/send/m.room.message/authorized", {
    msgtype: "m.text", body: "previously-authorized-content",
  }, admin.token);
  assert.equal(before.status, 200);
  const eventPath = path + "/event/" + encodeURIComponent(string(before.body.event_id));
  const readable = await request(fixture.base, "GET", eventPath, undefined, agent.token);
  assert.equal(readable.status, 200);
  const outsiderEvent = await request(fixture.base, "GET", eventPath, undefined, outsider.token);
  assert.equal(outsiderEvent.status, 403);
  const outsiderHistory = await request(fixture.base, "GET", path + "/messages?dir=b&limit=100", undefined, outsider.token);
  assert.equal(outsiderHistory.status, 200);
  assert(Array.isArray(outsiderHistory.body.chunk));
  assert.deepEqual(outsiderHistory.body.chunk.map(event => object(event).type), ["m.room.create"]);
  assert(Array.isArray(outsiderHistory.body.state));
  assert.deepEqual(outsiderHistory.body.state.map(event => object(event).state_key), [admin.id]);

  const file = "private-room-attachment-" + randomUUID();
  const uploaded = await requestBytes(fixture.base, "POST", "/_matrix/media/v3/upload?filename=private.txt",
    file, admin.token, "text/plain");
  assert.equal(uploaded.status, 200);
  const media = new URL(string(object(JSON.parse(uploaded.body.toString("utf8"))).content_uri));
  assert.equal(media.protocol, "mxc:");
  const mediaPath = encodeURIComponent(media.hostname) + "/" + encodeURIComponent(media.pathname.slice(1));
  const linked = await request(fixture.base, "PUT", path + "/send/m.room.message/attachment", {
    msgtype: "m.file", body: "private.txt", url: media.href,
  }, admin.token);
  assert.equal(linked.status, 200);

  await context.test("authorized native media download is a positive control", async () => {
    const downloaded = await requestBytes(fixture.base, "GET", "/_matrix/client/v1/media/download/" + mediaPath,
      undefined, agent.token);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.body.toString("utf8"), file);
  });

  await context.test("roomless identity still downloads known media through native authenticated media", async () => {
    const downloaded = await requestBytes(fixture.base, "GET", "/_matrix/client/v1/media/download/" + mediaPath,
      undefined, outsider.token);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.body.toString("utf8"), file);
    console.log("ACCEPTED native media: authenticated exact-link access does not require room membership.");
  });

  await context.test("native unauthenticated media routes deny this authenticated upload", async () => {
    const downloaded = await requestBytes(fixture.base, "GET", "/_matrix/media/v3/download/" + mediaPath);
    assert.equal(downloaded.status, 404);
    assert.equal(object(JSON.parse(downloaded.body.toString("utf8"))).errcode, "M_NOT_FOUND");
    const authenticatedRoute = await requestBytes(fixture.base, "GET", "/_matrix/client/v1/media/download/" + mediaPath);
    assert.equal(authenticatedRoute.status, 401);
  });

  const kicked = await request(fixture.base, "POST", path + "/kick", { user_id: agent.id }, admin.token);
  assert.equal(kicked.status, 200);
  const after = await request(fixture.base, "PUT", path + "/send/m.room.message/revoked", {
    msgtype: "m.text", body: "post-revocation-content",
  }, admin.token);
  assert.equal(after.status, 200);

  await context.test("native kick denies future room content with a positive control", async () => {
    const denied = await request(fixture.base, "GET", path + "/event/" +
      encodeURIComponent(string(after.body.event_id)), undefined, agent.token);
    assert.equal(denied.status, 403);
    const adminRead = await request(fixture.base, "GET", path + "/event/" +
      encodeURIComponent(string(after.body.event_id)), undefined, admin.token);
    assert.equal(adminRead.status, 200);
  });

  await context.test("native kick retains earlier authorized history and known attachment access", async () => {
    const history = await request(fixture.base, "GET", eventPath, undefined, agent.token);
    assert.equal(history.status, 200);
    assert.equal(object(history.body.content).body, "previously-authorized-content");
    const mediaRead = await requestBytes(fixture.base, "GET", "/_matrix/client/v1/media/download/" + mediaPath,
      undefined, agent.token);
    assert.equal(mediaRead.status, 200);
    assert.equal(mediaRead.body.toString("utf8"), file);
    console.log("ACCEPTED room removal: earlier authorized history and authenticated media links remain readable.");
  });

  await context.test("account deactivation blocks the old token and password login, unlike room removal", async () => {
    const challenge = await request(fixture.base, "POST", "/_matrix/client/v3/account/deactivate", {}, agent.token);
    assert.equal(challenge.status, 401);
    const deactivated = await request(fixture.base, "POST", "/_matrix/client/v3/account/deactivate", {
      auth: { type: "m.login.password", session: string(challenge.body.session),
        identifier: { type: "m.id.user", user: agent.id }, password: agent.password },
    }, agent.token);
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));
    const history = await request(fixture.base, "GET", eventPath, undefined, agent.token);
    assert.equal(history.status, 401);
    const mediaRead = await requestBytes(fixture.base, "GET", "/_matrix/client/v1/media/download/" + mediaPath,
      undefined, agent.token);
    assert.equal(mediaRead.status, 401);
    const login = await request(fixture.base, "POST", "/_matrix/client/v3/login", {
      type: "m.login.password", identifier: { type: "m.id.user", user: agent.id }, password: agent.password,
    });
    assert.equal(login.status, 403);
    assert.equal(login.body.errcode, "M_USER_DEACTIVATED");
  });
});
