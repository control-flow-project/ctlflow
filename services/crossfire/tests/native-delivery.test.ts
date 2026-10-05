import { localState as storage } from '@ctlflow/crossfire-adapter-filesystem/state';
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { conduitFixture } from "../scripts/architecture-proof/conduit-fixture.js";
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import { matrix } from '@ctlflow/crossfire-adapter-matrix/http';
import { acknowledge, loadCursors, readUnread, synchronize } from "@ctlflow/crossfire-agent-core/receive";
import type { Settings } from "@ctlflow/crossfire-contracts/client";
import { captureWake, collectBatch, pendingBatch, wakeEvent } from '@ctlflow/crossfire-agent-core/delivery';
import { messageArtifacts } from '@ctlflow/crossfire-agent-core/message-artifacts';

test("native unread recovery delivers selected state notices once and keeps receipts private", { timeout: 120_000 }, async scope => {
  mkdirSync(join(process.cwd(), ".temp"), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), ".temp/native-delivery-"));
  const cursorFile = join(directory, "cursor.json");
  const fixture = await conduitFixture(scope);
  const ownerAccount = await fixture.register("owner");
  const agentAccount = await fixture.register("agent");
  const guestAccount = await fixture.register("guest");
  const owner = matrix({ base: fixture.base, token: ownerAccount.token });
  const agent = matrix({ base: fixture.base, token: agentAccount.token });
  const settings: Settings = { instance: "tests", homeserver: fixture.base, server_name: "architecture.localhost",
    owner: ownerAccount.id, max_upload_bytes: 16 * 1024 * 1024 };
  const created = await owner.post<{ room_id: string }>(API + "/createRoom", {
    preset: "private_chat", name: "Before", invite: [agentAccount.id],
  });
  const room = created.room_id;
  const path = API + "/rooms/" + segment(room);
  await agent.post(path + "/join", {});
  const first = await readUnread(storage, agent, settings, cursorFile, 100);
  await acknowledge(storage, agent, cursorFile, first);
  assert.equal(existsSync(cursorFile + ".ack"), false);
  const ownerSync = await owner.get<{ next_batch: string }>(API + "/sync", { timeout: 0 });
  const expected: { event_id: string; type: string; content: unknown }[] = [];
  async function state(type: string, content: unknown) {
    const result = await owner.put<{ event_id: string }>(path + "/state/" + type + "/", content);
    expected.push({ event_id: result.event_id, type, content });
  }
  await state("m.room.name", { name: "After" });
  await state("m.room.topic", { topic: "New topic" });
  await state("m.room.history_visibility", { history_visibility: "joined" });
  await state("m.room.join_rules", { join_rule: "invite" });
  const powers = await owner.get(path + "/state/m.room.power_levels/");
  await state("m.room.power_levels", powers);
  const invited = await owner.post<{ event_id?: string }>(path + "/invite", { user_id: guestAccount.id });
  assert.equal(typeof invited, "object");
  await owner.put(path + "/state/m.room.avatar/", { url: "mxc://architecture.localhost/not-a-real-file" });
  const message = await owner.put<{ event_id: string }>(path + "/send/m.room.message/one", { msgtype: "m.text", body: "Live message" });
  expected.push({ event_id: message.event_id, type: "m.room.message", content: { msgtype: "m.text", body: "Live message" } });
  const batch = await readUnread(storage, agent, settings, cursorFile, 100);
  for (const event of expected) {
    const received = batch.events.filter(candidate => candidate.event_id === event.event_id);
    assert.equal(received.length, 1);
    assert.equal(received[0]!.type, event.type);
    assert.deepEqual(received[0]!.content, event.content);
    assert.equal(received[0]!.sender, ownerAccount.id);
    assert.equal(received[0]!.room_id, room);
  }
  assert(batch.events.some(event => event.type === "m.room.member" && event.state_key === guestAccount.id && event.content.membership === "invite"));
  assert.equal(batch.events.some(event => event.type === "m.room.avatar"), false);
  assert.deepEqual((await readUnread(storage, agent, settings, cursorFile, 100)).events, batch.events);
  await acknowledge(storage, agent, cursorFile, batch);
  assert.deepEqual(loadCursors(storage, cursorFile), batch.cursors);
  assert.equal(existsSync(cursorFile + ".ack"), false);
  assert.deepEqual((await readUnread(storage, agent, settings, cursorFile, 100)).events, []);
  const readState = await agent.get<{ event_id: string }>(API + "/user/" + segment(agentAccount.id)
    + "/rooms/" + segment(room) + "/account_data/m.fully_read");
  assert.equal(readState.event_id, message.event_id);
  const observed = await owner.get<{ rooms?: { join?: Record<string, { ephemeral?: { events?: unknown[] } }> } }>(API + "/sync", {
    since: ownerSync.next_batch, timeout: 0,
  });
  assert.equal(JSON.stringify(observed.rooms?.join?.[room]?.ephemeral?.events ?? []).includes(agentAccount.id), false);
  const filtered = await synchronize(agent);
  assert.equal(filtered.rooms?.join?.[room]?.timeline?.events.some(event => event.type === "m.room.avatar") ?? false, true);
  assert(batch.events.every(event => ["m.room.name", "m.room.topic", "m.room.history_visibility", "m.room.join_rules",
    "m.room.power_levels", "m.room.member", "m.room.message"].includes(event.type)));
  const guest = matrix({ base: fixture.base, token: guestAccount.token });
  await guest.post(path + '/join', {});
  await acknowledge(storage, agent, cursorFile, await readUnread(storage, agent, settings, cursorFile, 100));
  const contextIds: string[] = [];
  for (let index = 0; index < 5; index++) {
    const sent = await guest.put<{ event_id: string }>(path + '/send/m.room.message/context-' + index, { msgtype: 'm.text', body: 'Pending context ' + index });
    contextIds.push(sent.event_id);
  }
  const allowed = new Set([room]), senders = new Set([ownerAccount.id]);
  const artifacts = messageArtifacts(storage, cursorFile + '.messages', Date.now);
  const before = loadCursors(storage, cursorFile);
  const waiting = await pendingBatch(storage, agent, settings, cursorFile, 2, undefined, 65536, undefined, allowed, undefined, artifacts);
  assert.equal(await wakeEvent(agent, waiting, senders, allowed, undefined, async () => true), undefined);
  assert.deepEqual(loadCursors(storage, cursorFile), before);
  const waking = await owner.put<{ event_id: string }>(path + '/send/m.room.message/wake', { msgtype: 'm.text', body: 'Owner wake' });
  assert.equal(await wakeEvent(agent, waiting, new Set(), allowed, undefined, async () => true), undefined);
  assert.deepEqual(loadCursors(storage, cursorFile), before);
  const trigger = await wakeEvent(agent, waiting, senders, allowed, undefined, async () => true);
  assert.equal(trigger?.event_id, waking.event_id);
  const cycle = await captureWake(agent, trigger!, allowed, filtered.next_batch);
  const later = await guest.put<{ event_id: string }>(path + '/send/m.room.message/after-window', { msgtype: 'm.text', body: 'Wait for the next wake' });
  const collection = await collectBatch(storage, agent, settings, cursorFile, 2, 65536, waiting, cycle, allowed, artifacts);
  assert.deepEqual(collection.events.map(event => event.event_id), contextIds.slice(0, 2));
  assert.deepEqual(loadCursors(storage, cursorFile), before);
  await acknowledge(storage, agent, cursorFile, collection);
  const seen = collection.events.map(event => event.event_id);
  for (;;) {
    const next = await collectBatch(storage, agent, settings, cursorFile, 2, 65536,
      await pendingBatch(storage, agent, settings, cursorFile, 2, undefined, 65536, filtered.next_batch, allowed, cycle, artifacts), cycle, allowed, artifacts);
    seen.push(...next.events.map(event => event.event_id));
    await acknowledge(storage, agent, cursorFile, next);
    if (!next.more_rooms.length) break;
  }
  assert.deepEqual(seen, [...contextIds, waking.event_id]);
  const pending = await pendingBatch(storage, agent, settings, cursorFile, 2, undefined, 65536, filtered.next_batch, allowed, undefined, artifacts);
  assert.deepEqual(pending.events.map(event => event.event_id), [later.event_id]);
  assert.equal(await wakeEvent(agent, pending, senders, allowed, undefined, async () => true), undefined);
});
