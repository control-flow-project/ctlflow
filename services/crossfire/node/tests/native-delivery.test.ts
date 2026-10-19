import { createMessagingClient } from '@ctlflow/crossfire-adapter-matrix/messaging-client';
import { messageEvent } from '@ctlflow/crossfire-adapter-matrix/events';
import type { MatrixEvent } from '@ctlflow/crossfire-adapter-matrix/values';
import { localState as storage } from '@ctlflow/crossfire-adapter-filesystem/state';
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { conduitFixture } from "../scripts/architecture-proof/conduit-fixture.js";
import { API, segment } from '@ctlflow/crossfire-adapter-matrix/protocol';
import { matrix } from '@ctlflow/crossfire-adapter-matrix/http';
import { acknowledge, loadCursors, readUnread } from "@ctlflow/crossfire-agent-core/receive";
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
  const settings: Settings = { instance: "tests", server: fixture.base, backend: { type: "matrix", parameters: { origin: fixture.base, serverName: "architecture.localhost" } }, owner: ownerAccount.id, maxUploadBytes: 16 * 1024 * 1024 };
  const created = await owner.post<{ room_id: string }>(API + "/createRoom", {
    preset: "private_chat", name: "Before", invite: [agentAccount.id],
  });
  const room = created.room_id;
  const path = API + "/rooms/" + segment(room);
  await agent.post(path + "/join", {});
  const first = await readUnread(storage, createMessagingClient(agent, agentAccount.id), settings, cursorFile, 100);
  await acknowledge(storage, createMessagingClient(agent, agentAccount.id), cursorFile, first);
  assert.equal(existsSync(cursorFile + ".ack"), false);
  const ownerSync = await owner.get<{ next_batch: string }>(API + "/sync", { timeout: 0 });
  const expected: MatrixEvent[] = [];
  async function state(type: string, content: MatrixEvent['content']) {
    const result = await owner.put<{ event_id: string }>(path + "/state/" + type + "/", content);
    expected.push({ event_id: result.event_id, type, content, sender: ownerAccount.id });
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
  expected.push({ event_id: message.event_id, type: "m.room.message", sender: ownerAccount.id, content: { msgtype: "m.text", body: "Live message" } });
  const batch = await readUnread(storage, createMessagingClient(agent, agentAccount.id), settings, cursorFile, 100);
  for (const event of expected) {
    const received = batch.events.filter(candidate => candidate.eventId === event.event_id);
    assert.equal(received.length, 1);
    const normalized = messageEvent(event, room);
    assert.equal(received[0]!.type, normalized.type);
    assert.deepEqual(received[0]!.content, normalized.content);
    assert.equal(received[0]!.sender, ownerAccount.id);
    assert.equal(received[0]!.roomId, room);
  }
  assert(batch.events.some(event => event.type === "membership" && event.subjectId === guestAccount.id
    && event.content.attributes.content && typeof event.content.attributes.content === 'object'
    && !Array.isArray(event.content.attributes.content) && event.content.attributes.content.membership === "invite"));
  assert.equal(batch.events.some(event => event.type === "other"), false);
  assert.deepEqual((await readUnread(storage, createMessagingClient(agent, agentAccount.id), settings, cursorFile, 100)).events, batch.events);
  await acknowledge(storage, createMessagingClient(agent, agentAccount.id), cursorFile, batch);
  assert.deepEqual(loadCursors(storage, cursorFile), batch.cursors);
  assert.equal(existsSync(cursorFile + ".ack"), false);
  assert.deepEqual((await readUnread(storage, createMessagingClient(agent, agentAccount.id), settings, cursorFile, 100)).events, []);
  const readState = await agent.get<{ event_id: string }>(API + "/user/" + segment(agentAccount.id)
    + "/rooms/" + segment(room) + "/account_data/m.fully_read");
  assert.equal(readState.event_id, message.event_id);
  const observed = await owner.get<{ rooms?: { join?: Record<string, { ephemeral?: { events?: unknown[] } }> } }>(API + "/sync", {
    since: ownerSync.next_batch, timeout: 0,
  });
  assert.equal(JSON.stringify(observed.rooms?.join?.[room]?.ephemeral?.events ?? []).includes(agentAccount.id), false);
  const filtered = await createMessagingClient(agent, agentAccount.id).synchronize();
  assert.equal(filtered.rooms[room]?.events.some(event => event.type === "other") ?? false, true);
  assert(batch.events.every(event => ["name", "topic", "history-policy", "join-policy", "access", "membership", "message"].includes(event.type)));
  const guest = matrix({ base: fixture.base, token: guestAccount.token });
  await guest.post(path + '/join', {});
  await acknowledge(storage, createMessagingClient(agent, agentAccount.id), cursorFile, await readUnread(storage, createMessagingClient(agent, agentAccount.id), settings, cursorFile, 100));
  const contextIds: string[] = [];
  for (let index = 0; index < 5; index++) {
    const sent = await guest.put<{ event_id: string }>(path + '/send/m.room.message/context-' + index, { msgtype: 'm.text', body: 'Pending context ' + index });
    contextIds.push(sent.event_id);
  }
  const allowed = new Set([room]), senders = new Set([ownerAccount.id]);
  const artifacts = messageArtifacts(storage, cursorFile + '.messages', Date.now);
  const before = loadCursors(storage, cursorFile);
  const waiting = await pendingBatch(storage, createMessagingClient(agent, agentAccount.id), settings, cursorFile, 2, undefined, 65536, undefined, allowed, undefined, artifacts);
  assert.equal(await wakeEvent(createMessagingClient(agent, agentAccount.id), waiting, senders, allowed, undefined, async () => true), undefined);
  assert.deepEqual(loadCursors(storage, cursorFile), before);
  const waking = await owner.put<{ event_id: string }>(path + '/send/m.room.message/wake', { msgtype: 'm.text', body: 'Owner wake' });
  assert.equal(await wakeEvent(createMessagingClient(agent, agentAccount.id), waiting, new Set(), allowed, undefined, async () => true), undefined);
  assert.deepEqual(loadCursors(storage, cursorFile), before);
  const trigger = await wakeEvent(createMessagingClient(agent, agentAccount.id), waiting, senders, allowed, undefined, async () => true);
  assert.equal(trigger?.eventId, waking.event_id);
  const cycle = await captureWake(createMessagingClient(agent, agentAccount.id), trigger!, allowed, filtered.cursor);
  const later = await guest.put<{ event_id: string }>(path + '/send/m.room.message/after-window', { msgtype: 'm.text', body: 'Wait for the next wake' });
  const collection = await collectBatch(storage, createMessagingClient(agent, agentAccount.id), settings, cursorFile, 2, 65536, waiting, cycle, allowed, artifacts);
  assert.deepEqual(collection.events.map(event => event.eventId), contextIds.slice(0, 2));
  assert.deepEqual(loadCursors(storage, cursorFile), before);
  await acknowledge(storage, createMessagingClient(agent, agentAccount.id), cursorFile, collection);
  const seen = collection.events.map(event => event.eventId);
  for (;;) {
    const next = await collectBatch(storage, createMessagingClient(agent, agentAccount.id), settings, cursorFile, 2, 65536,
      await pendingBatch(storage, createMessagingClient(agent, agentAccount.id), settings, cursorFile, 2, undefined, 65536, filtered.cursor, allowed, cycle, artifacts), cycle, allowed, artifacts);
    seen.push(...next.events.map(event => event.eventId));
    await acknowledge(storage, createMessagingClient(agent, agentAccount.id), cursorFile, next);
    if (!next.moreRooms.length) break;
  }
  assert.deepEqual(seen, [...contextIds, waking.event_id]);
  const pending = await pendingBatch(storage, createMessagingClient(agent, agentAccount.id), settings, cursorFile, 2, undefined, 65536, filtered.cursor, allowed, undefined, artifacts);
  assert.deepEqual(pending.events.map(event => event.eventId), [later.event_id]);
  assert.equal(await wakeEvent(createMessagingClient(agent, agentAccount.id), pending, senders, allowed, undefined, async () => true), undefined);
});
