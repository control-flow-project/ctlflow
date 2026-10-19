import type { LocalState } from './port.js';
import type { MessagingClient } from './port.js';
import type { Settings } from '@ctlflow/crossfire-contracts/client';
import { roomId, userId } from '@ctlflow/crossfire-contracts/validation';
import { eventView, loadCursors, readUnread, roomQuota, validCursors, validReadBatch, validatePage, type HistoryEnd, type ReadBatch, type ReceivedEvent } from './receive.js';
import type { MessageArtifacts } from './message-artifacts.js';
import { HISTORY_RESOURCE_BYTES } from './history-resources.js';

export type WakeCycle = { ends: Record<string, HistoryEnd>; sender: string; room: string };

export function loadWake(storage: LocalState, file: string): WakeCycle | undefined {
  if (!storage.exists(file + '.wake')) return undefined;
  const value = storage.read<WakeCycle>(file + '.wake', HISTORY_RESOURCE_BYTES);
  if (!value || !value.ends || Array.isArray(value.ends) || typeof value.ends !== 'object'
    || !userId(value.sender) || !roomId(value.room) || Object.keys(value.ends).length > 1000) throw new Error('Invalid saved wake-up cycle');
  for (const [room, end] of Object.entries(value.ends)) {
    if (!roomId(room) || !end || typeof end.cursor !== 'string' || !end.cursor) throw new Error('Invalid saved wake-up boundary');
    if (end.event !== null) eventView(end.event, room);
  }
  return value;
}

export async function captureWake(client: MessagingClient, trigger: ReceivedEvent, rooms: ReadonlySet<string>, boundary: string): Promise<WakeCycle> {
  const ends: Record<string, HistoryEnd> = Object.create(null);
  for (const room of [...rooms].sort()) {
    const page = await client.history(room, { direction: 'backward', limit: 1 });
    validatePage(page, 1, undefined);
    const event = page.events[0] ?? null;
    if (event) eventView(event, room);
    ends[room] = { cursor: page.end ?? boundary, event };
  }
  return { sender: trigger.sender, room: trigger.roomId, ends };
}

export function saveWake(storage: LocalState, file: string, cycle?: WakeCycle): void {
  if (cycle) storage.write(file + '.wake', cycle, HISTORY_RESOURCE_BYTES);
  else if (storage.exists(file + '.wake')) storage.remove(file + '.wake');
}

export function retireSnapshot(storage: LocalState, file: string, rooms: ReadonlySet<string>): void {
  if (!storage.exists(file + '.snapshot')) return;
  const value = storage.read<{ base: Record<string, string>; batch: ReadBatch }>(file + '.snapshot', HISTORY_RESOURCE_BYTES);
  if (!value || !validCursors(value.base) || !validReadBatch(value.batch)) throw new Error('Invalid pinned delivery snapshot');
  value.batch.events = value.batch.events.filter(event => !rooms.has(event.roomId));
  for (const room of rooms) { delete value.base[room]; delete value.batch.cursors[room]; delete value.batch.latest[room]; }
  value.batch.moreRooms = value.batch.moreRooms.filter(room => !rooms.has(room));
  if (Object.keys(value.batch.cursors).some(room => value.base[room] === undefined)) storage.write(file + '.snapshot', value, HISTORY_RESOURCE_BYTES);
  else storage.remove(file + '.snapshot');
}

export function snapshotContentFiles(storage: LocalState, file: string): string[] {
  if (!storage.exists(file + '.snapshot')) return [];
  const value = storage.read<{ base: Record<string, string>; batch: ReadBatch }>(file + '.snapshot', HISTORY_RESOURCE_BYTES);
  if (!value || !validCursors(value.base) || !validReadBatch(value.batch)) throw new Error('Invalid pinned delivery snapshot');
  return value.batch.events.flatMap(event => event.contentFile ? [event.contentFile.file] : []);
}

export async function pendingBatch(storage: LocalState, client: MessagingClient, settings: Settings, file: string, limit: number,
  selected: string | undefined, maximum: number, boundary: string | undefined, allowed: ReadonlySet<string>, cycle: WakeCycle | undefined, artifacts: MessageArtifacts): Promise<ReadBatch> {
  const base = loadCursors(storage, file);
  if (storage.exists(file + '.snapshot')) {
    const saved = storage.read<{ base: Record<string, string>; batch: ReadBatch }>(file + '.snapshot', HISTORY_RESOURCE_BYTES);
    if (!saved || !validCursors(saved.base) || !validReadBatch(saved.batch)) throw new Error('Invalid pinned delivery snapshot');
    if (JSON.stringify(saved.base) === JSON.stringify(base)) {
      const included = (room: string) => allowed.has(room) && (!selected || room === selected);
      if (!cycle) {
        const added = new Set((await client.joinedRooms()).filter(room => included(room) && !Object.hasOwn(saved.batch.cursors, room)));
        if (added.size) {
          const initial = await readUnread(storage, client, settings, file, limit, selected, maximum, boundary, added, undefined, artifacts.stage);
          saved.batch = { events: [...saved.batch.events, ...initial.events],
            cursors: { ...saved.batch.cursors, ...Object.fromEntries(Object.entries(initial.cursors).filter(([room]) => added.has(room))) },
            latest: { ...saved.batch.latest, ...initial.latest },
            moreRooms: [...new Set([...saved.batch.moreRooms, ...initial.moreRooms])] };
          storage.write(file + '.snapshot', saved, HISTORY_RESOURCE_BYTES);
        }
      }
      const batch = saved.batch;
      return { ...batch, events: batch.events.filter(event => included(event.roomId)),
        cursors: { ...base, ...Object.fromEntries(Object.entries(batch.cursors).filter(([room]) => included(room))) },
        latest: Object.fromEntries(Object.entries(batch.latest).filter(([room]) => included(room))),
        moreRooms: batch.moreRooms.filter(included) };
    }
    storage.remove(file + '.snapshot');
  }
  const batch = await readUnread(storage, client, settings, file, limit, selected, maximum, boundary, allowed,
    cycle ? { cursors: base, ends: cycle.ends } : undefined, artifacts.stage);
  if (Object.keys(batch.cursors).some(room => base[room] === undefined)) storage.write(file + '.snapshot', { base, batch }, HISTORY_RESOURCE_BYTES);
  return batch;
}

export async function wakeEvent(client: MessagingClient, batch: ReadBatch, senders: ReadonlySet<string>,
  allowed: ReadonlySet<string>, selected: string | undefined, accept: (event: ReceivedEvent) => Promise<boolean>): Promise<ReceivedEvent | undefined> {
  const eligible = async (event: ReceivedEvent) => event.type === "message" && senders.has(event.sender) && await accept(event);
  for (const event of batch.events) if (await eligible(event)) return event;
  const identities = [...senders];
  for (const room of [...allowed].filter(room => !selected || room === selected).sort()) {
    const start = batch.cursors[room];
    if (!start) continue;
    for (let offset = 0; offset < identities.length; offset += 50) {
      let from = start;
      const visited = new Set<string>();
      for (;;) {
        const page = await client.history(room, {
          from, direction: 'forward', limit: 100, filter: { types: ['message'], senders: identities.slice(offset, offset + 50) },
        });
        validatePage(page, 100, from);
        for (const event of page.events) {
          const candidate = eventView(event, room);
          if (await eligible(candidate)) return candidate;
        }
        if (!page.events.length) break;
        if (!page.end || visited.has(page.end)) throw new Error('Wake-up history cursor did not advance');
        visited.add(page.end); from = page.end;
      }
    }
  }
  return undefined;
}

export async function collectBatch(storage: LocalState, client: MessagingClient, settings: Settings, file: string, limit: number, maximum: number,
  initial: ReadBatch, cycle: WakeCycle, allowed: ReadonlySet<string>, artifacts: MessageArtifacts): Promise<ReadBatch> {
  let batch = initial;
  const rooms = Object.keys(cycle.ends).filter(room => allowed.has(room)).sort();
  for (const [position, room] of rooms.entries()) {
    const remaining = roomQuota(limit, rooms.length, position) - batch.events.filter(event => event.roomId === room).length;
    if (remaining <= 0 || batch.cursors[room] === cycle.ends[room]!.cursor) continue;
    const next = await readUnread(storage, client, settings, file, remaining, room, maximum, undefined, new Set([room]),
      { cursors: batch.cursors, ends: cycle.ends }, artifacts.stage);
    let events = [...batch.events, ...next.events];
    if (events.some(event => event.contentFile) || events.reduce((bytes, event) => bytes + Buffer.byteLength(JSON.stringify(event)), 0) > maximum) events = artifacts.stage(events);
    batch = { events, cursors: { ...batch.cursors, [room]: next.cursors[room]! }, latest: { ...batch.latest, ...next.latest }, moreRooms: [] };
  }
  batch.events.sort((left, right) => (left.timestamp ?? '').localeCompare(right.timestamp ?? ''));
  return { ...batch, moreRooms: rooms.filter(room => batch.cursors[room] !== cycle.ends[room]!.cursor) };
}
