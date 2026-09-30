import type { LocalState, Transport } from './port.js';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { API, segment } from '@crossfire/contracts/matrix';
import type { Matrix } from './port.js';
import { selectRoom } from '@crossfire/contracts/validation';
import type { Account, Settings, Event } from '@crossfire/contracts/client';
import type { Coordination } from './coordination.js';
import { synchronize, loadSyncCursor, checkpointSync, membershipResets, acknowledge, flushAcknowledgements, retainJoinedCursors, deliveryText, eventView, joinedRooms, type ReceivedEvent } from './receive.js';
import { captureWake, collectBatch, pendingBatch, wakeEvent, loadWake, saveWake, retireSnapshot } from './delivery.js';
import type { RuntimeAdapter } from './runtime.js';
import { DEFAULT_OUTPUT_BYTES, MAX_OUTPUT_BYTES } from '@crossfire/contracts/limits';
import { loadControl, saveControl, humanEvents, humanText, isControl } from './control.js';
import { permissions } from './permissions.js';
import { reportActivity } from './activity.js';
import { requireCurrentRelease } from './release.js';
import type { Manifest } from '@crossfire/contracts/release';
import { isListenerNotice, mentionsAgent } from '@crossfire/contracts/notices';
import { incrementalEvents } from './receive.js';
import type { PrincipalIdentity } from '@crossfire/contracts/schema/response';
import { deliveryEvents, resolveSenders } from './senders.js';
import { testListener, type ListenerTest } from './diagnostic.js';
import { releaseUpdates } from './updates.js';

export function deliveryBatches(events: readonly ReceivedEvent[], settings: Settings, self: string,
  identities: ReadonlyMap<string, PrincipalIdentity>, maximum = DEFAULT_OUTPUT_BYTES) {
  if (!Number.isSafeInteger(maximum) || maximum < 1024 || maximum > MAX_OUTPUT_BYTES) throw new Error('Invalid Codex input budget');
  const batches: { text: string; messageId: string; messages: number }[] = [];
  let current: ReceivedEvent[] = [];
  function flush(): void {
    if (!current.length) return;
    batches.push({ text: deliveryText(current, settings, identities), messageId: 'crossfire-' + createHash('sha256')
      .update(JSON.stringify([settings.instance, ...current.map(event => [event.room_id, event.event_id])])).digest('hex'),
    messages: current.filter(event => event.type === 'm.room.message').length });
    current = [];
  }
  for (const event of deliveryEvents(events, self)) {
    if (Buffer.byteLength(deliveryText([event], settings, identities)) > maximum) throw new Error(`A chat event exceeds the ${maximum}-byte Codex input limit; retrieve it explicitly`);
    if (Buffer.byteLength(deliveryText([...current, event], settings, identities)) > maximum) flush();
    current.push(event);
  }
  flush();
  return batches;
}

export type ListenerOptions = {
  storage: LocalState;
  transport: Transport;
  ready?: (test: () => Promise<ListenerTest>) => void;
  release: Manifest;
  coordination: Coordination;
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
  const storage = options.storage;
  if (!Number.isSafeInteger(options.reconcileMs) || options.reconcileMs < 1000 || options.reconcileMs > 600_000) {
    throw new Error('Listener reconciliation interval must be 1000..600000 ms');
  }
  const current = await requireCurrentRelease(options.coordination, options.release, stop);
  if (!current.ok) throw new Error(current.error.message);
  const failed = new AbortController();
  const lifetime = AbortSignal.any([stop, failed.signal]);
  const approval = options.approvalRoom ? permissions({
    client: options.transport(lifetime, 45_000),
    coordination: options.coordination, settings: options.settings, account: options.account, agent: options.id, room: options.approvalRoom, expiresMs: 300_000,
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
  const updates = releaseUpdates(storage, options.cursorFile, options.release.release, options.settings.owner, destination.sessionId);
  const signal = AbortSignal.any([stop, destination.signal, failed.signal]);
  const client = options.transport(signal, 45_000);
  const maximum = options.maximumBytes ?? DEFAULT_OUTPUT_BYTES;
  const controlFile = options.cursorFile + '.control';
  const state = loadControl(storage, controlFile, destination.sessionId);
  let since = loadSyncCursor(storage, options.cursorFile);
  let synchronized = false;
  let allowed = new Set<string>();
  let senders = new Set<string>();
  const urgentControl = () => senders.has(options.settings.owner) ? state.controls.findLast(control => control.status === 'interrupted') : undefined;
  let cycle = loadWake(storage, options.cursorFile);
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
      return await operation(options.transport(scope, Math.min(45_000, options.reconcileMs)), scope);
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
  async function send(operation: (scope: AbortSignal) => Promise<void>): Promise<boolean> {
    const cancel = new AbortController();
    const done = (async () => {
      try {
        await operation(AbortSignal.any([cancel.signal, signal]));
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
  async function deliver(events: readonly ReceivedEvent[]): Promise<{ accepted: boolean; messageIds: string[] }> {
    if (!senders.size) return { accepted: false, messageIds: [] };
    let messageIds: string[] = [];
    const accepted = await send(async scope => {
      const emitted = deliveryEvents(events, options.account.user_id);
      const identities = await resolveSenders(options.coordination, emitted, scope);
      const batches = deliveryBatches(emitted, options.settings, options.account.user_id, identities, maximum);
      messageIds = batches.map(batch => batch.messageId);
      for (const batch of batches) {
        pendingMessages = batch.messages;
        await destination.deliver(batch.text, batch.messageId, scope);
        activity?.delivered(pendingMessages);
        pendingMessages = 0;
      }
    });
    return { accepted, messageIds };
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
  async function access(): Promise<boolean> {
    const parsed = await options.coordination.delivery(options.id, signal);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const view = parsed.value;
    if (view.agentId !== options.id || view.matrixUserId !== options.account.user_id || view.ownerMatrixId !== options.settings.owner
      || view.status !== 'active' || view.ownerStatus !== 'active') throw new Error('Agent or owner access is no longer active');
    const next = new Set(view.roomGrants.filter(grant => !grant.muted).map(grant => grant.roomId));
    const nextSenders = new Set(view.senderMatrixIds);
    const different = next.size !== allowed.size || [...allowed].some(room => !next.has(room))
      || nextSenders.size !== senders.size || [...senders].some(sender => !nextSenders.has(sender));
    if (different) {
      await cancelDelivery();
      retireSnapshot(storage, options.cursorFile, new Set([...allowed].filter(room => !next.has(room))));
      allowed = next;
      senders = nextSenders;
      membershipRevision++;
    }
    lastAccess = performance.now();
    return different;
  }
  try {
    await work(() => access());
    await flushAcknowledgements(storage, client, options.cursorFile);
    for (const control of state.controls.filter(control => control.status === 'interrupting')) {
      if (control.turn) await destination.interrupt(control.turn, true);
      control.status = control.stop ? 'delivered' : 'interrupted';
      state.paused = control.stop;
      saveControl(storage, controlFile, state);
    }
    const selected = options.room ? selectRoom(options.room) : undefined;
    let joined = new Set(await joinedRooms(client));
    retainJoinedCursors(storage, options.cursorFile, joined);
    activity = await reportActivity(options.coordination, options.id, options.release, signal, release => { updates.available(release); changed(); });
    activity.signal.addEventListener('abort', () => failed.abort(activity?.signal.reason), { once: true });
    if (activity.signal.aborted) failed.abort(activity.signal.reason);
    signal.throwIfAborted();
    options.ready?.(() => {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
      return testListener({ coordination: options.coordination, runtime: destination, matrix: options.transport(deadline, 10000),
        id: options.id, owner: options.settings.owner, matrixUserId: options.account.user_id, paused: state.paused, signal: deadline });
    });
    acquisition = (async () => {
      for (;;) {
        signal.throwIfAborted();
        await work(async (client, scope) => {
        const synced = await retry(() => synchronize(client, since, Math.min(options.pollMs, Math.floor(options.reconcileMs / 2))), scope);
        controlling = true;
        const membership = new Set(await joinedRooms(client));
        const membershipChanged = membership.size !== joined.size || [...joined].some(room => !membership.has(room));
        const accessChanged = membershipChanged || performance.now() - lastAccess >= options.reconcileMs ? await retry(() => access(), scope) : false;
        const humans = (await retry(() => humanEvents(client, options.settings, synced, since, selected), scope))
          .filter(event => allowed.has(event.room_id));
        const reset = await retry(() => membershipResets(client, synced, options.account, since), scope);
        for (const room of joined) if (!membership.has(room)) reset.add(room);
        if (reset.size) {
          if (cycle && reset.has(cycle.room)) { cycle = undefined; saveWake(storage, options.cursorFile); windowEnd = 0; }
          membershipRevision++;
          for (const room of reset) retiredRooms.add(room);
          await cancelDelivery();
          retireSnapshot(storage, options.cursorFile, reset);
          retainJoinedCursors(storage, options.cursorFile, new Set([...membership].filter(room => !reset.has(room))));
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
            saveControl(storage, controlFile, state);
            if (turn) await destination.interrupt(turn);
            const saved = state.controls.at(-1)!;
            saved.status = saved.stop ? 'delivered' : 'interrupted';
            state.paused = saved.stop;
            saveControl(storage, controlFile, state);
          }
        }
        joined = membership;
        if (since) for (const room of membership) {
          if (!allowed.has(room) || reset.has(room) || selected && selected !== room) continue;
          const events = await incrementalEvents(client, synced, since, room, { types: ['m.room.message'] });
          for (const event of events) if (!senders.has(event.sender) && mentionsAgent(event, options.account.user_id)) {
            const notice = await options.coordination.notice(options.id, room, event.event_id, scope);
            if (!notice.ok) throw Object.assign(new Error(notice.error.message), { code: notice.error.code });
          }
        }
        saveControl(storage, controlFile, state);
        checkpointSync(storage, options.cursorFile, synced.next_batch);
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
      const urgent = urgentControl();
      if (urgent) {
        if (!joined.has(urgent.room) || !allowed.has(urgent.room)) { urgent.status = 'superseded'; saveControl(storage, controlFile, state); continue; }
        const event = await client.get<Event>(`${API}/rooms/${segment(urgent.room)}/event/${segment(urgent.event)}`);
        if (event.event_id !== urgent.event || event.sender !== options.settings.owner) throw new Error('Urgent event identity changed');
        if (controlling || state.paused) continue;
        const attempt = await deliver([eventView(event, urgent.room)]);
        if (attempt.accepted || await settle()) {
          urgent.status = 'delivered';
          saveControl(storage, controlFile, state);
          destination.acknowledge(attempt.messageIds);
        }
        continue;
      }
      retiredRooms.clear();
      if (updates.pending()) { await send(scope => updates.publish(destination, scope)); continue; }
      if (cycle && (!allowed.has(cycle.room) || !joined.has(cycle.room) || !senders.has(cycle.sender))) {
        cycle = undefined; saveWake(storage, options.cursorFile); windowEnd = 0;
      }
      const membershipAtRead = membershipRevision;
      let batch = await work((client, scope) => retry(() => pendingBatch(storage, client, options.settings, options.cursorFile, options.limit,
        selected, maximum, since, allowed, cycle), scope));
      if (membershipAtRead !== membershipRevision || controlling || state.paused || urgentControl()) continue;
      if (!senders.size) { windowEnd = 0; await wait(previous); continue; }
      async function accept(event: ReceivedEvent): Promise<boolean> {
        if (isListenerNotice(event)) return false;
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
          saveWake(storage, options.cursorFile, cycle); windowEnd = 0;
        } else if (pending.length) { windowEnd = 0; await wait(previous); continue; }
      }
      if (cycle) batch = await work(client => collectBatch(storage, client, options.settings, options.cursorFile, batch, options.limit,
        selected, maximum, cycle!, allowed));
      if (membershipAtRead !== membershipRevision || controlling || state.paused || urgentControl()) continue;
      const events: ReceivedEvent[] = [];
      for (const event of batch.events) if (await accept(event)) events.push(event);
      const attempt = await deliver(events);
      if (!attempt.accepted && !await settle()) continue;
      await work((client, scope) => retry(async () => {
        await acknowledge(storage, client, options.cursorFile, { ...batch,
          cursors: Object.fromEntries(Object.entries(batch.cursors).filter(([room]) => !retiredRooms.has(room))),
          latest: Object.fromEntries(Object.entries(batch.latest).filter(([room]) => !retiredRooms.has(room))) });
      }, scope));
      destination.acknowledge(attempt.messageIds);
      if (membershipAtRead !== membershipRevision) continue;
      state.controls = state.controls.filter(control => !batch.events.some(event => event.room_id === control.room && event.event_id === control.event));
      saveControl(storage, controlFile, state);
      if (!batch.more_rooms.length) { cycle = undefined; saveWake(storage, options.cursorFile); }
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
