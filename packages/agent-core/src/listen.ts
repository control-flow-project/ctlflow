import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { API, matrix, segment, type Matrix } from '../../matrix/src/http.js';
import { selectRoom } from './state.js';
import type { Account, Settings, Event } from '../../contracts/src/client.js';
import { deliveryPolicy } from '../../contracts/src/delivery.js';
import { synchronize, loadSyncCursor, checkpointSync, membershipResets, acknowledge, flushAcknowledgements, retainJoinedCursors, deliveryText, eventView, joinedRooms, type ReceivedEvent } from './receive.js';
import { captureWake, collectBatch, pendingBatch, wakeEvent, loadWake, saveWake, retireSnapshot } from './delivery.js';
import type { RuntimeAdapter } from './runtime.js';
import { DEFAULT_OUTPUT_BYTES, MAX_OUTPUT_BYTES } from '../../contracts/src/limits.js';
import { loadControl, saveControl, humanEvents, humanText, isControl } from './control.js';
import { permissions } from './permissions.js';
import { reportActivity } from './activity.js';
import { requireCurrentRelease } from './release.js';
import type { Manifest } from '../../contracts/src/release.js';

export function deliveryBatches(events: readonly ReceivedEvent[], settings: Settings, self: string, maximum = DEFAULT_OUTPUT_BYTES) {
  if (!Number.isSafeInteger(maximum) || maximum < 1024 || maximum > MAX_OUTPUT_BYTES) throw new Error('Invalid Codex input budget');
  const batches: { text: string; messageId: string; messages: number }[] = [];
  let current: ReceivedEvent[] = [];
  function flush(): void {
    if (!current.length) return;
    batches.push({ text: deliveryText(current, settings), messageId: 'crossfire-' + createHash('sha256')
      .update(JSON.stringify([settings.instance, ...current.map(event => [event.room_id, event.event_id])])).digest('hex'),
    messages: current.filter(event => event.type === 'm.room.message').length });
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
  ready?: () => void;
  release: Manifest;
  settings: Settings;
  account: Account;
  cursorFile: string;
  room?: string;
  limit: number;
  maximumBytes?: number;
  pollMs: number;
  debounceMs: number;
  runtime: RuntimeAdapter;
  approvalRoom?: string;
  id: string;
  reconcileMs: number;
};

function retryable(error: unknown): boolean {
  if (error instanceof Error && 'status' in error && typeof error.status === 'number') return error.status === 429 || error.status >= 500;
  return error instanceof Error && 'code' in error
    && ['native', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(String(error.code));
}

export async function listen(options: ListenerOptions, stop: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(options.reconcileMs) || options.reconcileMs < 1000 || options.reconcileMs > 600_000) {
    throw new Error('Listener reconciliation interval must be 1000..600000 ms');
  }
  const current = await requireCurrentRelease({ base: options.settings.homeserver, signal: stop }, options.release);
  if (!current.ok) throw new Error(current.error.message);
  const failed = new AbortController();
  const lifetime = AbortSignal.any([stop, failed.signal]);
  const approval = options.approvalRoom ? permissions({
    client: matrix({ base: options.settings.homeserver, token: options.account.access_token, signal: lifetime, timeoutMs: 45_000 }),
    settings: options.settings, account: options.account, agent: options.id, room: options.approvalRoom, expiresMs: 300_000,
  }, lifetime) : undefined;
  let destination: Awaited<ReturnType<RuntimeAdapter>>;
  try {
    destination = await options.runtime(lifetime, options.pollMs, {
      requestPermission: async (permission, cancelled) => {
        if (!approval) throw new Error('Runtime approval requires an explicitly selected authorized --approval-room');
        return approval.request(permission, cancelled);
      },
    });
  } catch (error) { failed.abort(error); approval?.close(); throw error; }
  const signal = AbortSignal.any([stop, destination.signal, failed.signal]);
  const client = matrix({ base: options.settings.homeserver, token: options.account.access_token, signal, timeoutMs: 45_000 });
  const maximum = options.maximumBytes ?? DEFAULT_OUTPUT_BYTES;
  const controlFile = options.cursorFile + '.control';
  const state = loadControl(controlFile, destination.sessionId);
  let since = loadSyncCursor(options.cursorFile);
  let synchronized = false;
  let allowed = new Set<string>();
  let senders = new Set<string>();
  let cycle = loadWake(options.cursorFile);
  let windowEnd = 0;
  let lastAccess = -Infinity;
  let wake: (() => void) | undefined;
  let revision = 0;
  let controlling = false;
  let waitingForControl = false;
  let membershipRevision = 0;
  const retiredRooms = new Set<string>();
  let sending: { cancel: AbortController; done: Promise<boolean> } | undefined;
  let activity: Awaited<ReturnType<typeof reportActivity>> | undefined;
  let pendingMessages = 0;
  const changed = () => { revision++; wake?.(); };
  async function retry<Result>(operation: () => Promise<Result>, scope = signal): Promise<Result> {
    for (let failures = 0; ; failures++) {
      try { return await operation(); }
      catch (error) {
        scope.throwIfAborted();
        if (!retryable(error) || failures >= 3) throw error;
        await delay(Math.min(options.pollMs, 1000 * 2 ** failures), undefined, { signal: scope });
      }
    }
  }
  async function work<Result>(operation: (client: Matrix, scope: AbortSignal) => Promise<Result>): Promise<Result> {
    const deadline = AbortSignal.timeout(options.reconcileMs);
    const scope = AbortSignal.any([signal, deadline]);
    const cancel = () => failed.abort(new Error('Listener acquisition exceeded its reconciliation deadline'));
    deadline.addEventListener('abort', cancel, { once: true });
    try {
      return await operation(matrix({ base: options.settings.homeserver, token: options.account.access_token,
        signal: scope, timeoutMs: Math.min(45_000, options.reconcileMs) }), scope);
    } finally { deadline.removeEventListener('abort', cancel); }
  }
  async function wait(previous: number, milliseconds = options.reconcileMs, control = false): Promise<void> {
    signal.throwIfAborted();
    if (previous !== revision) return;
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); wake = undefined; waitingForControl = false; resolve(); };
      const timer = setTimeout(finish, milliseconds);
      wake = finish;
      waitingForControl = control;
      signal.addEventListener('abort', finish, { once: true });
    });
    signal.throwIfAborted();
  }
  async function deliver(events: readonly ReceivedEvent[]): Promise<boolean> {
    const cancel = new AbortController();
    const done = (async () => {
      try {
        for (const batch of deliveryBatches(events, options.settings, options.account.user_id, maximum)) {
          pendingMessages = batch.messages;
          await destination.deliver(batch.text, batch.messageId, AbortSignal.any([cancel.signal, signal]));
          activity?.delivered(pendingMessages);
          pendingMessages = 0;
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
  async function settle(): Promise<boolean> {
    const confirmed = await destination.settle();
    if (confirmed) activity?.delivered(pendingMessages);
    pendingMessages = 0;
    return confirmed;
  }
  let acquisition: Promise<void> | undefined;
  const backstop = setInterval(changed, options.reconcileMs);
  async function access(client: Matrix): Promise<boolean> {
    const parsed = deliveryPolicy(await client.get('/_coord/agents/' + options.id + '/delivery'));
    if (!parsed.ok) throw new Error(parsed.error.message);
    const view = parsed.value;
    if (view.id !== options.id || view.userId !== options.account.user_id || view.owner !== options.settings.owner
      || view.status !== 'active' || view.ownerStatus !== 'active') throw new Error('Agent or owner access is no longer active');
    const next = new Set(view.grants.filter(grant => !grant.muted).map(grant => grant.room));
    const nextSenders = new Set(view.senders);
    const different = next.size !== allowed.size || [...allowed].some(room => !next.has(room))
      || nextSenders.size !== senders.size || [...senders].some(sender => !nextSenders.has(sender));
    if (different) {
      await cancelDelivery();
      retireSnapshot(options.cursorFile, new Set([...allowed].filter(room => !next.has(room))));
      allowed = next;
      senders = nextSenders;
      membershipRevision++;
    }
    lastAccess = performance.now();
    return different;
  }
  try {
    await work(client => access(client));
    await flushAcknowledgements(client, options.cursorFile);
    for (const control of state.controls.filter(control => control.status === 'interrupting')) {
      if (control.turn) await destination.interrupt(control.turn, true);
      control.status = control.stop ? 'delivered' : 'interrupted';
      state.paused = control.stop;
      saveControl(controlFile, state);
    }
    const selected = options.room ? selectRoom(options.room) : undefined;
    let joined = new Set(await joinedRooms(client));
    retainJoinedCursors(options.cursorFile, joined);
    activity = await reportActivity({ base: options.settings.homeserver, token: options.account.access_token }, options.id, options.release, signal);
    activity.signal.addEventListener('abort', () => failed.abort(activity?.signal.reason), { once: true });
    if (activity.signal.aborted) failed.abort(activity.signal.reason);
    signal.throwIfAborted();
    options.ready?.();
    acquisition = (async () => {
      for (;;) {
        signal.throwIfAborted();
        await work(async (client, scope) => {
        const synced = await retry(() => synchronize(client, since, Math.min(options.pollMs, Math.floor(options.reconcileMs / 2))), scope);
        controlling = true;
        const membership = new Set(await joinedRooms(client));
        const membershipChanged = membership.size !== joined.size || [...joined].some(room => !membership.has(room));
        const accessChanged = membershipChanged || performance.now() - lastAccess >= options.reconcileMs ? await retry(() => access(client), scope) : false;
        const humans = (await retry(() => humanEvents(client, options.settings, synced, since, selected), scope))
          .filter(event => allowed.has(event.room_id));
        const reset = await retry(() => membershipResets(client, synced, options.account, since), scope);
        for (const room of joined) if (!membership.has(room)) reset.add(room);
        if (reset.size) {
          if (cycle && reset.has(cycle.room)) { cycle = undefined; saveWake(options.cursorFile); windowEnd = 0; }
          membershipRevision++;
          for (const room of reset) retiredRooms.add(room);
          await cancelDelivery();
          retireSnapshot(options.cursorFile, reset);
          retainJoinedCursors(options.cursorFile, new Set([...membership].filter(room => !reset.has(room))));
          state.controls = state.controls.filter(control => !reset.has(control.room));
        }
        for (const event of humans) {
          if (!joined.has(event.room_id) || !membership.has(event.room_id) || reset.has(event.room_id)) continue;
          if (state.controls.some(control => control.room === event.room_id && control.event === event.event_id)) continue;
          if (await approval?.consume(event)) continue;
          if (!await isControl(client, options.settings, options.account, event)) {
            if (state.paused && humanText(event, options.settings.owner)) { state.paused = false; changed(); }
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
        const initial = !synchronized;
        synchronized = true;
        controlling = false;
        if (initial || waitingForControl || accessChanged || reset.size || humans.length
          || Object.values(synced.rooms?.join ?? {}).some(room => (room.timeline?.events.length ?? 0) > 0)) changed();
        });
      }
    })().catch(error => { failed.abort(error); changed(); });
    while (!signal.aborted) {
      const previous = revision;
      if (!synchronized || state.paused) { await wait(previous); continue; }
      if (controlling) { await wait(previous, options.reconcileMs, true); continue; }
      const urgent = state.controls.findLast(control => control.status === 'interrupted');
      if (urgent) {
        if (!joined.has(urgent.room) || !allowed.has(urgent.room)) { urgent.status = 'superseded'; saveControl(controlFile, state); continue; }
        const event = await client.get<Event>(`${API}/rooms/${segment(urgent.room)}/event/${segment(urgent.event)}`);
        if (event.event_id !== urgent.event || event.sender !== options.settings.owner) throw new Error('Urgent event identity changed');
        if (controlling || state.paused) continue;
        if (await deliver([eventView(event, urgent.room)]) || await settle()) {
          urgent.status = 'delivered';
          saveControl(controlFile, state);
        }
        continue;
      }
      retiredRooms.clear();
      if (cycle && (!allowed.has(cycle.room) || !joined.has(cycle.room) || !senders.has(cycle.sender))) {
        cycle = undefined; saveWake(options.cursorFile); windowEnd = 0;
      }
      const membershipAtRead = membershipRevision;
      let batch = await work((client, scope) => retry(() => pendingBatch(client, options.settings, options.cursorFile, options.limit,
        selected, maximum, since, allowed, cycle), scope));
      if (membershipAtRead !== membershipRevision || controlling || state.paused || state.controls.some(control => control.status === 'interrupted')) continue;
      async function accept(event: ReceivedEvent): Promise<boolean> {
        if (event.sender === options.account.user_id && event.type === 'm.room.message') return false;
        if (state.controls.some(control => control.room === event.room_id && control.event === event.event_id && control.status === 'delivered')) return false;
        return !await approval?.consume(event);
      }
      const pending: ReceivedEvent[] = [];
      for (const event of batch.events) if (await accept(event)) pending.push(event);
      if (!cycle) {
        const trigger = await work(client => wakeEvent(client, batch, senders, allowed, selected, accept));
        if (trigger) {
          const now = performance.now();
          if (!windowEnd) windowEnd = now + options.debounceMs;
          if (now < windowEnd) { await wait(previous, Math.ceil(windowEnd - now)); continue; }
          cycle = await work(client => captureWake(client, trigger,
            new Set(Object.keys(batch.cursors).filter(room => allowed.has(room) && (!selected || room === selected))), since!));
          saveWake(options.cursorFile, cycle); windowEnd = 0;
        } else if (pending.length) { windowEnd = 0; await wait(previous); continue; }
      }
      if (cycle) batch = await work(client => collectBatch(client, options.settings, options.cursorFile, batch, options.limit,
        selected, maximum, cycle!, allowed));
      if (membershipAtRead !== membershipRevision || controlling || state.paused || state.controls.some(control => control.status === 'interrupted')) continue;
      const events: ReceivedEvent[] = [];
      for (const event of batch.events) if (await accept(event)) events.push(event);
      if (!await deliver(events) && !await settle()) continue;
      await work((client, scope) => retry(async () => {
        await acknowledge(client, options.cursorFile, { ...batch,
          cursors: Object.fromEntries(Object.entries(batch.cursors).filter(([room]) => !retiredRooms.has(room))),
          latest: Object.fromEntries(Object.entries(batch.latest).filter(([room]) => !retiredRooms.has(room))) });
      }, scope));
      if (membershipAtRead !== membershipRevision) continue;
      state.controls = state.controls.filter(control => !batch.events.some(event => event.room_id === control.room && event.event_id === control.event));
      saveControl(controlFile, state);
      if (!batch.more_rooms.length) { cycle = undefined; saveWake(options.cursorFile); }
      if (!batch.more_rooms.length) await wait(previous);
    }
    signal.throwIfAborted();
  } finally {
    clearInterval(backstop);
    failed.abort(new Error('Listener stopped'));
    approval?.close();
    wake?.();
    await acquisition;
    await activity?.close();
    await destination.close();
  }
}
