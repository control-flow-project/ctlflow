import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { API, Matrix, MatrixError, segment, selectRoom, type Account, type Settings, type Event } from './lib.ts';
import { readUnread, sharedRooms, synchronize, loadSyncCursor, checkpointSync, membershipResets, acknowledge, flushAcknowledgements, retainJoinedCursors, deliveryText, eventView, type ReceivedEvent } from './receive.ts';
import { connectCodex, type CodexOptions } from './codex.ts';
import { DEFAULT_OUTPUT_BYTES, MAX_OUTPUT_BYTES } from './limits.ts';
import { loadControl, saveControl, humanEvents, isControl } from './control.ts';

export function deliveryBatches(events: readonly ReceivedEvent[], settings: Settings, self: string, maximum = DEFAULT_OUTPUT_BYTES) {
  if (!Number.isSafeInteger(maximum) || maximum < 1024 || maximum > MAX_OUTPUT_BYTES) throw new Error('Invalid Codex input budget');
  const batches: { text: string; messageId: string; humanMessages: number; peerMessages: number }[] = [];
  let current: ReceivedEvent[] = [];
  function flush(): void {
    if (!current.length) return;
    const humanMessages = current.filter(event => event.sender === settings.observer).length;
    batches.push({ text: deliveryText(current, settings), messageId: 'crossfire-' + createHash('sha256')
      .update(JSON.stringify([settings.instance, ...current.map(event => [event.room_id, event.event_id])])).digest('hex'),
    humanMessages, peerMessages: current.length - humanMessages });
    current = [];
  }
  for (const event of events) {
    if (event.sender === self && event.type === 'm.room.message') continue;
    if (Buffer.byteLength(deliveryText([event], settings)) > maximum) throw new Error(`A chat event exceeds the ${maximum}-byte Codex input limit; retrieve it explicitly`);
    if (Buffer.byteLength(deliveryText([...current, event], settings)) > maximum) flush();
    current.push(event);
  }
  flush();
  return batches;
}

export type ListenerOptions = {
  settings: Settings;
  account: Account;
  cursorFile: string;
  room?: string;
  limit: number;
  maximumBytes?: number;
  pollMs: number;
  debounceMs: number;
  codex: CodexOptions;
};

function retryable(error: unknown): boolean {
  if (error instanceof MatrixError) return error.status === 429 || error.status >= 500;
  return error instanceof Error && 'code' in error
    && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(String(error.code));
}

export async function listen(options: ListenerOptions, stop: AbortSignal): Promise<void> {
  const destination = await connectCodex({ ...options.codex, pollMs: options.pollMs }, stop);
  const failed = new AbortController();
  const signal = AbortSignal.any([stop, destination.signal, failed.signal]);
  const client = new Matrix(options.settings.homeserver, options.account.access_token, signal);
  const maximum = options.maximumBytes ?? DEFAULT_OUTPUT_BYTES;
  const controlFile = options.cursorFile + '.control';
  const state = loadControl(controlFile, options.codex.thread);
  let since = loadSyncCursor(options.cursorFile);
  let synchronized = false;
  let wake: (() => void) | undefined;
  let revision = 0;
  let controlling = false;
  let membershipRevision = 0;
  const retiredRooms = new Set<string>();
  let sending: { cancel: AbortController; done: Promise<boolean> } | undefined;
  const changed = () => { revision++; wake?.(); };
  async function retry<Result>(operation: () => Promise<Result>): Promise<Result> {
    for (let failures = 0; ; failures++) {
      try { return await operation(); }
      catch (error) {
        signal.throwIfAborted();
        if (!retryable(error) || failures >= 3) throw error;
        await delay(Math.min(options.pollMs, 1000 * 2 ** failures), undefined, { signal });
      }
    }
  }
  async function wait(previous: number, milliseconds = options.pollMs): Promise<void> {
    signal.throwIfAborted();
    if (previous !== revision) return;
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); wake = undefined; resolve(); };
      const timer = setTimeout(finish, milliseconds);
      wake = finish;
      signal.addEventListener('abort', finish, { once: true });
    });
    signal.throwIfAborted();
  }
  async function deliver(events: readonly ReceivedEvent[]): Promise<boolean> {
    const cancel = new AbortController();
    const done = (async () => {
      try {
        for (const batch of deliveryBatches(events, options.settings, options.account.user_id, maximum)) {
          await destination.deliver(batch.text, batch.messageId, AbortSignal.any([cancel.signal, signal]));
        }
        return true;
      } catch (error) {
        signal.throwIfAborted();
        if (cancel.signal.aborted) return false;
        throw error;
      }
    })();
    sending = { cancel, done };
    try { return await done; }
    finally { sending = undefined; }
  }
  async function cancelDelivery(): Promise<void> {
    if (!sending) return;
    sending.cancel.abort(new Error('Delivery superseded by human control or membership change'));
    await sending.done;
  }
  let acquisition: Promise<void> | undefined;
  try {
    await flushAcknowledgements(client, options.cursorFile);
    for (const control of state.controls.filter(control => control.status === 'interrupting')) {
      if (control.turn) await destination.interrupt(control.turn, true);
      control.status = control.stop ? 'delivered' : 'interrupted';
      state.paused = control.stop;
      saveControl(controlFile, state);
    }
    await sharedRooms(client, options.settings);
    const selected = options.room ? selectRoom(options.settings, options.room) : undefined;
    let joined = new Set((await client.get<{ joined_rooms: string[] }>(API + '/joined_rooms')).joined_rooms);
    retainJoinedCursors(options.cursorFile, joined);
    acquisition = (async () => {
      for (;;) {
        signal.throwIfAborted();
        const synced = await retry(() => synchronize(client, options.settings, options.account, since, options.pollMs));
        const humans = await retry(() => humanEvents(client, options.settings, synced, since, selected));
        controlling = true;
        const membership = new Set((await client.get<{ joined_rooms: string[] }>(API + '/joined_rooms')).joined_rooms);
        const reset = await retry(() => membershipResets(client, synced, options.account, since));
        for (const room of joined) if (!membership.has(room)) reset.add(room);
        if (reset.size) {
          membershipRevision++;
          for (const room of reset) retiredRooms.add(room);
          await cancelDelivery();
          retainJoinedCursors(options.cursorFile, new Set([...membership].filter(room => !reset.has(room))));
          state.controls = state.controls.filter(control => !reset.has(control.room));
        }
        for (const event of humans) {
          if (!joined.has(event.room_id) || !membership.has(event.room_id) || reset.has(event.room_id)) continue;
          if (state.controls.some(control => control.room === event.room_id && control.event === event.event_id)) continue;
          if (!await isControl(client, options.settings, options.account, event)) {
            if (state.paused) { state.paused = false; changed(); }
            continue;
          }
          {
            await cancelDelivery();
            const turn = await destination.activeTurn();
            for (const earlier of state.controls) if (earlier.status === 'interrupted') earlier.status = 'superseded';
            const control = { room: event.room_id, event: event.event_id, stop: String(event.content.body).trim() === '!!',
              turn, status: 'interrupting' as const };
            state.controls.push(control);
            saveControl(controlFile, state);
            if (turn) await destination.interrupt(turn);
            const saved = state.controls.at(-1)!;
            saved.status = saved.stop ? 'delivered' : 'interrupted';
            state.paused = saved.stop;
            saveControl(controlFile, state);
          }
        }
        joined = membership;
        saveControl(controlFile, state);
        checkpointSync(options.cursorFile, synced.next_batch);
        since = synced.next_batch;
        synchronized = true;
        controlling = false;
        changed();
      }
    })().catch(error => { failed.abort(error); changed(); });
    let windowEnd = 0, humanMessages = 0, peerMessages = 0;
    while (!signal.aborted) {
      const previous = revision;
      if (!synchronized || controlling || state.paused) { await wait(previous); continue; }
      const urgent = state.controls.findLast(control => control.status === 'interrupted');
      if (urgent) {
        if (!joined.has(urgent.room)) { urgent.status = 'superseded'; saveControl(controlFile, state); continue; }
        const event = await client.get<Event>(`${API}/rooms/${segment(urgent.room)}/event/${segment(urgent.event)}`);
        if (event.event_id !== urgent.event || event.sender !== options.settings.observer) throw new Error('Urgent event identity changed');
        if (controlling || state.paused) continue;
        if (await deliver([eventView(event, urgent.room)]) || await destination.settle()) {
          urgent.status = 'delivered';
          saveControl(controlFile, state);
        }
        continue;
      }
      retiredRooms.clear();
      const membershipAtRead = membershipRevision;
      const batch = await retry(() => readUnread(client, options.settings, options.cursorFile, options.limit,
        options.room, maximum, since));
      if (membershipAtRead !== membershipRevision || controlling || state.paused || state.controls.some(control => control.status === 'interrupted')) continue;
      const events = batch.events.filter(event => !state.controls.some(control => control.room === event.room_id
        && control.event === event.event_id && control.status === 'delivered'));
      const deliveries = deliveryBatches(events, options.settings, options.account.user_id, maximum);
      const now = performance.now();
      if (deliveries.length) {
        const immediate = deliveries.some(delivery => delivery.humanMessages > 0 && humanMessages < 5
          || delivery.peerMessages > 0 && peerMessages < 3);
        if (!immediate && now < windowEnd) { await wait(previous, Math.ceil(windowEnd - now)); continue; }
        windowEnd = now + options.debounceMs;
        humanMessages = Math.min(5, humanMessages + deliveries.reduce((count, batch) => count + batch.humanMessages, 0));
        peerMessages = Math.min(3, peerMessages + deliveries.reduce((count, batch) => count + batch.peerMessages, 0));
      } else if (now >= windowEnd) { windowEnd = 0; humanMessages = 0; peerMessages = 0; }
      if (!await deliver(events) && !await destination.settle()) continue;
      await retry(async () => {
        await acknowledge(client, options.cursorFile, { ...batch,
          cursors: Object.fromEntries(Object.entries(batch.cursors).filter(([room]) => !retiredRooms.has(room))),
          latest: Object.fromEntries(Object.entries(batch.latest).filter(([room]) => !retiredRooms.has(room))) });
      });
      if (membershipAtRead !== membershipRevision) continue;
      state.controls = state.controls.filter(control => !batch.events.some(event => event.room_id === control.room && event.event_id === control.event));
      saveControl(controlFile, state);
      if (!batch.more_rooms.length) await wait(previous);
    }
    signal.throwIfAborted();
  } finally {
    failed.abort(new Error('Listener stopped'));
    wake?.();
    await acquisition;
    destination.close();
  }
}
