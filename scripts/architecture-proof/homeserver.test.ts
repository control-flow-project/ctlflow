import assert from "node:assert/strict";
import test from "node:test";
import { conduitFixture, conduitImage } from "./conduit-fixture.js";
import { object, request, string } from "./native-http.js";

test("pinned Conduit native capabilities and characterized limits", { timeout: 180_000 }, async context => {
  const fixture = await conduitFixture(context);
  const admin = await fixture.register("fixture-admin");
  const owner = await fixture.register("alice");
  const agent = await fixture.register("holmes");
  console.log("Homeserver fixture:", conduitImage);

  await context.test("native account registration does not automatically join configured rooms", async () => {
    const response = await request(fixture.base, "GET", "/_matrix/client/v3/joined_rooms", undefined, agent.token);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.joined_rooms, []);
  });

  const created = await request(fixture.base, "POST", "/_matrix/client/v3/createRoom", {
    preset: "private_chat", invite: [owner.id, agent.id],
    initial_state: [{ type: "m.room.history_visibility", state_key: "", content: { history_visibility: "joined" } }],
  }, admin.token);
  assert.equal(created.status, 200);
  const room = string(created.body.room_id);
  const path = "/_matrix/client/v3/rooms/" + encodeURIComponent(room);
  for (const member of [owner, agent]) {
    const joined = await request(fixture.base, "POST", path + "/join", {}, member.token);
    assert.equal(joined.status, 200);
  }
  const current = await request(fixture.base, "GET", path + "/state/m.room.power_levels/", undefined, admin.token);
  assert.equal(current.status, 200);
  const powers = await request(fixture.base, "PUT", path + "/state/m.room.power_levels/", {
    ...current.body,
    users: { ...object(current.body.users ?? {}), [owner.id]: 1, [agent.id]: 0 },
    users_default: 0, events_default: 1, state_default: 100, invite: 100, kick: 100, ban: 100, redact: 100,
  }, admin.token);
  assert.equal(powers.status, 200, JSON.stringify(powers.body));

  await context.test("positive control: native power levels deny ordinary messages", async () => {
    const response = await request(fixture.base, "PUT", path + "/send/m.room.message/denied", {
      msgtype: "m.text", body: "This must be denied",
    }, agent.token);
    assert.equal(response.status, 403);
    assert.equal(response.body.errcode, "M_FORBIDDEN");
  });

  await context.test("native read-only power levels still permit typing", async () => {
    const response = await request(fixture.base, "PUT", path + "/typing/" + encodeURIComponent(agent.id), {
      typing: true, timeout: 5000,
    }, agent.token);
    assert.equal(response.status, 200);
    console.log("NATIVE read-only limit: typing accepted (200).");
  });

  await context.test("independent membership retains history until agent access is changed", async () => {
    const kicked = await request(fixture.base, "POST", path + "/kick", { user_id: owner.id }, admin.token);
    assert.equal(kicked.status, 200);
    const sent = await request(fixture.base, "PUT", path + "/send/m.room.message/post-owner", {
      msgtype: "m.text", body: "after-owner-removal",
    }, admin.token);
    assert.equal(sent.status, 200);
    const eventPath = path + "/event/" + encodeURIComponent(string(sent.body.event_id));
    const ownerDenied = await request(fixture.base, "GET", eventPath, undefined, owner.token);
    assert.equal(ownerDenied.status, 403);
    assert.equal(ownerDenied.body.errcode, "M_FORBIDDEN");
    const history = await request(fixture.base, "GET", path + "/messages?dir=b&limit=20", undefined, agent.token);
    assert.equal(history.status, 200);
    assert(Array.isArray(history.body.chunk));
    assert(history.body.chunk.some(value => object(object(value).content).body === "after-owner-removal"));
    console.log("NATIVE ownership limit: agent membership does not track designated owner membership.");
  });

  await context.test("native agent profile remains mutable independently of configured naming", async () => {
    const path = "/_matrix/client/v3/profile/" + encodeURIComponent(agent.id) + "/displayname";
    const changed = await request(fixture.base, "PUT", path, { displayname: "Ownerless name" }, agent.token);
    assert.equal(changed.status, 200);
    const read = await request(fixture.base, "GET", path, undefined, admin.token);
    assert.equal(read.status, 200);
    assert.equal(read.body.displayname, "Ownerless name");
    console.log("NATIVE naming limit: self-profile mutation accepted (200).");
  });

  await context.test("a successful presence PUT does not establish readable native presence", async () => {
    const path = "/_matrix/client/v3/presence/" + encodeURIComponent(agent.id) + "/status";
    const changed = await request(fixture.base, "PUT", path, { presence: "online" }, agent.token);
    assert.equal(changed.status, 200);
    const read = await request(fixture.base, "GET", path, undefined, admin.token);
    assert.equal(read.status, 404);
    assert.equal(read.body.errcode, "M_NOT_FOUND");
    console.log("NATIVE presence limit: update accepted (200), shared-room read returned M_NOT_FOUND (404).");
  });
});
