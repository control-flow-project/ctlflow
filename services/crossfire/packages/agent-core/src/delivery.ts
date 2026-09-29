import { existsSync, unlinkSync } from 'node:fs';
import { readJson, writeJson } from '../../files/src/index.js';
import { API, segment, type Matrix } from '../../matrix/src/http.js';
import type { Settings, Event } from '../../contracts/src/client.js';
import { roomId, userId } from '../../contracts/src/management.js';
import { deliveryText, eventView, loadCursors, readUnread, validatePage, type HistoryEnd, type ReadBatch, type ReceivedEvent } from './receive.js';

export type WakeCycle = { ends: Record<string, HistoryEnd>; sender: string; room: string };

export function loadWake(file: string): WakeCycle | undefined {
  if (!existsSync(file + '.wake')) return undefined;
  const value = readJson<WakeCycle>(file + '.wake');
  if (!value || !value.ends || Array.isArray(value.ends) || typeof value.ends !== 'object'
    || !userId(value.sender) || !roomId(value.room) || Object.keys(value.ends).length > 100) throw new Error('Invalid saved wake-up cycle');
  for (const [room, end] of Object.entries(value.ends)) {
    if (!roomId(room) || !end || typeof end.cursor !== 'string' || !end.cursor) throw new Error('Invalid saved wake-up boundary');
    if (end.event !== null) eventView(end.event, room);
  }
  return value;
}

export async function captureWake(client: Matrix, trigger: ReceivedEvent, rooms: ReadonlySet<string>, boundary: string): Promise<WakeCycle> {
  const ends: Record<string, HistoryEnd> = {};
  for (const room of [...rooms].sort()) {
    const page = await client.get<{ chunk: Event[]; end?: string }>(`${API}/rooms/${segment(room)}/messages`, { dir: 'b', limit: 1 });
    validatePage(page, 1, undefined);
    const event = page.chunk[0] ?? null;
    if (event) eventView(event, room);
    ends[room] = { cursor: page.end ?? boundary, event };
  }
  return { sender: trigger.sender, room: trigger.room_id, ends };
}

export function saveWake(file: string, cycle?: WakeCycle): void {
  if (cycle) writeJson(file + '.wake', cycle);
  else if (existsSync(file + '.wake')) unlinkSync(file + '.wake');
}

export function retireSnapshot(file: string, rooms: ReadonlySet<string>): void {
  if (!existsSync(file + '.snapshot')) return;
  const value = readJson<{ base: Record<string, string>; batch: ReadBatch }>(file + '.snapshot');
  value.batch.events = value.batch.events.filter(event => !rooms.has(event.room_id));
  for (const room of rooms) { delete value.base[room]; delete value.batch.cursors[room]; delete value.batch.latest[room]; }
  value.batch.more_rooms = value.batch.more_rooms.filter(room => !rooms.has(room));
  writeJson(file + '.snapshot', value);
}

export async function pendingBatch(client: Matrix, settings: Settings, file: string, limit: number,
  selected: string | undefined, maximum: number, boundary: string | undefined, allowed: ReadonlySet<string>, cycle?: WakeCycle): Promise<ReadBatch> {
  const base = loadCursors(file);
  if (existsSync(file + '.snapshot')) {
    const saved = readJson<{ base: Record<string, string>; batch: ReadBatch }>(file + '.snapshot');
    if (!saved || !saved.base || !saved.batch || !Array.isArray(saved.batch.events) || !saved.batch.cursors
      || !saved.batch.latest || !Array.isArray(saved.batch.more_rooms)) throw new Error('Invalid pinned delivery snapshot');
    if (JSON.stringify(saved.base) === JSON.stringify(base)) {
      const batch = saved.batch;
      if (Buffer.byteLength(deliveryText(batch.events, settings)) > maximum) throw new Error('Pinned snapshot exceeds the input byte limit');
      const included = (room: string) => allowed.has(room) && (!selected || room === selected);
      return { ...batch, events: batch.events.filter(event => included(event.room_id)),
        cursors: { ...base, ...Object.fromEntries(Object.entries(batch.cursors).filter(([room]) => included(room))) },
        latest: Object.fromEntries(Object.entries(batch.latest).filter(([room]) => included(room))),
        more_rooms: batch.more_rooms.filter(included) };
    }
    unlinkSync(file + '.snapshot');
  }
  const batch = await readUnread(client, settings, file, limit, selected, maximum, boundary, allowed,
    cycle ? { cursors: base, ends: cycle.ends } : undefined);
  if (Object.keys(batch.cursors).some(room => base[room] === undefined)) writeJson(file + '.snapshot', { base, batch });
  return batch;
}

export async function wakeEvent(client: Matrix, batch: ReadBatch, senders: ReadonlySet<string>,
  allowed: ReadonlySet<string>, selected: string | undefined, accept: (event: ReceivedEvent) => Promise<boolean>): Promise<ReceivedEvent | undefined> {
  const eligible = async (event: ReceivedEvent) => event.type === 'm.room.message' && senders.has(event.sender) && await accept(event);
  for (const event of batch.events) if (await eligible(event)) return event;
  const identities = [...senders];
  for (const room of [...allowed].filter(room => !selected || room === selected).sort()) {
    const start = batch.cursors[room];
    if (!start) continue;
    for (let offset = 0; offset < identities.length; offset += 50) {
      let from = start;
      const visited = new Set<string>();
      for (;;) {
        const page = await client.get<{ chunk: Event[]; end?: string }>(`${API}/rooms/${segment(room)}/messages`, {
          from, dir: 'f', limit: 100, filter: JSON.stringify({ types: ['m.room.message'], senders: identities.slice(offset, offset + 50) }),
        });
        validatePage(page, 100, from);
        for (const event of page.chunk) {
          const candidate = eventView(event, room);
          if (await eligible(candidate)) return candidate;
        }
        if (!page.chunk.length) break;
        if (!page.end || visited.has(page.end)) throw new Error('Wake-up history cursor did not advance');
        visited.add(page.end); from = page.end;
      }
    }
  }
  return undefined;
}

export async function collectBatch(client: Matrix, settings: Settings, file: string, initial: ReadBatch,
  limit: number, selected: string | undefined, maximum: number, cycle: WakeCycle, allowed: ReadonlySet<string>): Promise<ReadBatch> {
  let result = initial;
  for (;;) {
    let pageLimit = limit;
    let next: ReadBatch;
    for (;;) {
      next = await readUnread(client, settings, file, pageLimit, selected, maximum, undefined, allowed,
        { cursors: result.cursors, ends: cycle.ends });
      if (Buffer.byteLength(deliveryText([...result.events, ...next.events], settings)) <= maximum - 1024) break;
      if (pageLimit === 1) return { ...result, more_rooms: [...allowed],
        events: result.events.sort((left, right) => (left.timestamp ?? '').localeCompare(right.timestamp ?? '')) };
      pageLimit = Math.max(1, Math.floor(pageLimit / 2));
    }
    result = { events: [...result.events, ...next.events], cursors: next.cursors,
      latest: { ...result.latest, ...next.latest }, more_rooms: next.more_rooms };
    if (!next.more_rooms.length) return { ...result,
      events: result.events.sort((left, right) => (left.timestamp ?? '').localeCompare(right.timestamp ?? '')) };
  }
}
