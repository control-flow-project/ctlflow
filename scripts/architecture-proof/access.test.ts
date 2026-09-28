import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { conduitFixture } from "./conduit-fixture.js";
import { object, request, requestBytes, string } from "./native-http.js";

test("native admission and applied revocation boundaries", { timeout: 180_000 }, async context => {
  const fixture = await conduitFixture(context, { allowRoomCreation: false });
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

  await context.test("roomless agent cannot create rooms, join uninvited or fetch room content", async () => {
    const joined = await request(fixture.base, "GET", "/_matrix/client/v3/joined_rooms", undefined, outsider.token);
    assert.deepEqual(joined.body.joined_rooms, []);
    const create = await request(fixture.base, "POST", "/_matrix/client/v3/createRoom", {}, outsider.token);
    assert.equal(create.status, 403);
    const join = await request(fixture.base, "POST", path + "/join", {}, outsider.token);
    assert.equal(join.status, 403);
    const history = await request(fixture.base, "GET", path + "/messages?dir=b&limit=10", undefined, outsider.token);
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.chunk, []);
    assert.deepEqual(history.body.state, []);
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
    console.log("UNRESOLVED media boundary: zero-room identity reads known private-room attachment.");
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
    console.log("UNRESOLVED revocation boundary: old server-side history/media remain readable after kick.");
  });
});
