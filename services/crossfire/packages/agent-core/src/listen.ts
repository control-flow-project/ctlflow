import type { Clock, LocalState, Transport } from './port.js';
import { createHash } from 'node:crypto';
import { API, segment } from '@crossfire/contracts/matrix';
import type { Matrix } from './port.js';
import { selectRoom } from '@crossfire/contracts/validation';
import type { Account, Settings, Event } from '@crossfire/contracts/client';
import type { Coordination } from './coordination.js';
import { synchronize, loadSyncCursor, checkpointSync, membershipResets, acknowledge, flushAcknowledgements, retainJoinedCursors, deliveryText, eventView, joinedRooms, type ReceivedEvent } from './receive.js';
import { captureWake, collectBatch, pendingBatch, wakeEvent, loadWake, saveWake, retireSnapshot } from './delivery.js';
import type { RuntimeAdapter } from './runtime.js';
import { DEFAULT_OUTPUT_BYTES, MAX_OUTPUT_BYTES } from '@crossfire/contracts/limits';
import { loadControl, saveControl, humanEvents, humanText, isControl, publishControlNotice } from './control.js';
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
import { controlledPublisher, waitForActivation, type ListenerControl } from './listener-control.js';
import type { ReadBatch } from './receive.js';
import { scheduledPublisher } from './scheduled.js';
import { failure } from '@crossfire/kernel/result';

export function deliveryBatches(events: readonly ReceivedEvent[], settings: Settings, self: string,
  identities: ReadonlyMap<string, PrincipalIdentity>, maximum = DEFAULT_OUTPUT_BYTES) {
  if (!Number.isSafeInteger(maximum) || maximum < 1024 || maximum > MAX_OUTPUT_BYTES) throw new Error('Invalid runtime input budget');
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
    if (Buffer.byteLength(deliveryText([event], settings, identities)) > maximum) throw new Error(`A chat event exceeds the ${maximum}-byte runtime input limit; retrieve it explicitly`);
    if (Buffer.byteLength(deliveryText([...current, event], settings, identities)) > maximum) flush();
    current.push(event);
  }
  flush();
  return batches;
}

export type ListenerOptions = {
  clock: Clock;
  control?: ListenerControl;
  storage: LocalState;
  transport: Transport;
  invitationRooms: (signal: AbortSignal) => Promise<readonly string[]>;
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
    && ['native', 'unavailable', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(String(error.code));
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
    clock: options.clock,
    coordination: options.coordination, settings: options.settings, account: options.account, agent: options.id, room: options.approvalRoom, expiresMs: 300_000,
  }, lifetime) : undefined;
  let destination: Awaited<ReturnType<RuntimeAdapter>>;
  try {
    destination = await options.runtime(lifetime, options.pollMs, {
      requestPermission: async (permission, cancelled) => {
        if (!approval) return failure('forbidden', 'Runtime approval requires an explicitly selected authorized --approval-room');
        return approval.request(permission, cancelled);
      },
    });
  } catch (error) { failed.abort(error); approval?.close(); throw error; }
  const updates = releaseUpdates(storage, options.cursorFile, options.release.release, options.settings.owner, destination.sessionId);
  const controlled = options.control ? controlledPublisher(storage, options.cursorFile + '.controller-input', options.control, destination) : undefined;
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
  const scheduled = scheduledPublisher({ storage, clock: options.clock, file: options.cursorFile + '.wake-input', coordination: options.coordination,
    agentId: options.id, runtime: destination, attachment: () => {
      if (!activity) throw new Error('Scheduled delivery requires a reporting listener');
      return { runId: activity.runId, sessionId: destination.sessionId };
    } });
  let completed: { batch: ReadBatch; messageIds: string[]; membership: number } | undefined;
  let pendingMessages = 0;
  const invitations = new Map<string, number>();
  let lastInvitationCheck = -Infinity;
  const changed = () => { revision++; wake?.(); };
  async function retry<Result>(operation: () => Promise<Result>, scope = signal): Promise<Result> {
    for (let failures = 0; ; failures++) {
      try { return await operation(); }
      catch (error) {
        scope.throwIfAborted();
        if (!retryable(error) || failures >= 3) throw error;
        await options.clock.delay(Math.min(options.pollMs, 1000 * 2 ** failures), scope);
      }
    }
  }
  async function work<Result>(operation: (client: Matrix, scope: AbortSignal) => Promise<Result>): Promise<Result> {
    const deadline = AbortSignal.timeout(options.reconcileMs);
    const scope = AbortSignal.any([signal, deadline, ...(options.control ? [options.control.current().signal] : [])]);
    const cancel = () => {
      if (options.control) options.control.unavailable('Fleet listener acquisition exceeded its reconciliation deadline');
      else failed.abort(new Error('Listener acquisition exceeded its reconciliation deadline'));
    };
    deadline.addEventListener('abort', cancel, { once: true });
    try {
      return await operation(options.transport(scope, Math.min(45_000, options.reconcileMs)), scope);
    } catch (error) {
      if (options.control && retryable(error) && !signal.aborted) options.control.unavailable('Fleet listener coordination is unavailable');
      throw error;
    } finally { deadline.removeEventListener('abort', cancel); }
  }
  async function wait(previous: number, milliseconds = options.reconcileMs, control = false): Promise<void> {
    signal.throwIfAborted();
    if (previous !== revision) return;
    await new Promise<void>(resolve => {
      const finish = () => { cancelTimer(); signal.removeEventListener('abort', finish); wake = undefined; waitingForControl = false; resolve(); };
      const cancelTimer = options.clock.schedule(finish, !control && activity && synchronized && !state.paused
        && (!options.control || options.control.current().active) ? Math.min(milliseconds, scheduled.waitMs()) : milliseconds);
      wake = finish;
      waitingForControl = control;
      signal.addEventListener('abort', finish, { once: true });
    });
    signal.throwIfAborted();
  }
  async function send(operation: (scope: AbortSignal) => Promise<void>): Promise<boolean> {
    if (options.control && !options.control.current().active) return false;
    const generation = options.control?.current().signal;
    const cancel = new AbortController();
    const done = (async () => {
      try {
        await operation(AbortSignal.any([cancel.signal, signal, ...(options.control ? [options.control.current().signal] : [])]));
        return true;
      } catch (error) {
        signal.throwIfAborted();
        if (cancel.signal.aborted || generation?.aborted) return false;
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
  const cancelBackstop = options.clock.schedule(changed, options.reconcileMs, true);
  async function access(scope = signal): Promise<boolean> {
    const parsed = await options.coordination.delivery(options.id, scope);
    if (!parsed.ok) throw Object.assign(new Error(parsed.error.message), { code: parsed.error.code });
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
    lastAccess = options.clock.now();
    return different;
  }
  const unsubscribe = options.control?.subscribe(() => {
    if (!options.control?.current().active) {
      membershipRevision++;
      void cancelDelivery().catch(error => failed.abort(error));
    }
    changed();
  });
  async function startActivity(): Promise<void> {
    if (activity) return;
    try { activity = await reportActivity(options.coordination, options.id, options.release, signal, !!options.control, options.clock, release => { updates.available(release); changed(); }); }
    catch (error) { if (options.control && retryable(error)) options.control.unavailable('Fleet listener heartbeat is unavailable'); throw error; }
    activity.signal.addEventListener('abort', () => failed.abort(activity?.signal.reason), { once: true });
    if (activity.signal.aborted) failed.abort(activity.signal.reason);
  }
  try {
    if (destination.approval === 'listener' && !approval) {
      throw new Error('Native approval policy requires an explicit --approval-room. Grant that room read/reply access and join it as the owner before connecting.');
    }
    if (approval) {
      const authorized = await approval.authorize();
      if (!authorized.ok) throw new Error('Native approval setup is not ready: ' + authorized.error.message);
    }
    await access();
    await flushAcknowledgements(storage, client, options.cursorFile);
    for (const control of state.controls.filter(control => control.status === 'interrupting')) {
      if (control.turn) {
        if (!destination.turnControl) throw new Error('Native turn cancellation is unavailable for this attachment');
        await destination.turnControl.interrupt(control.turn, true);
      }
      control.status = control.stop ? 'delivered' : 'interrupted';
      state.paused = control.stop;
      saveControl(storage, controlFile, state);
    }
    const selected = options.room ? selectRoom(options.room) : undefined;
    let joined = new Set(await joinedRooms(client));
    retainJoinedCursors(storage, options.cursorFile, joined);
    if (!options.control || options.control.current().active) await startActivity();
    signal.throwIfAborted();
    options.ready?.(() => {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
      return testListener({ coordination: options.coordination, runtime: destination, matrix: options.transport(deadline, 10000),
        ...(approval ? { authorizeApproval: approval.authorize } : {}),
        id: options.id, owner: options.settings.owner, matrixUserId: options.account.user_id, paused: state.paused || !!options.control && !options.control.current().active, signal: deadline });
    });
    acquisition = (async () => {
      for (;;) {
        signal.throwIfAborted();
        if (options.control) await waitForActivation(options.control, signal);
        const generation = options.control?.current().signal;
        try {
        await work(async (client, scope) => {
        const synced = await retry(() => synchronize(client, since, Math.min(options.pollMs, Math.floor(options.reconcileMs / 2))), scope);
        controlling = true;
        if (options.clock.now() - lastInvitationCheck >= options.reconcileMs
          || Object.keys(synced.rooms?.invite ?? {}).length > 0 || Object.keys(synced.rooms?.leave ?? {}).length > 0) {
          const pending = new Set(await retry(() => options.invitationRooms(scope), scope));
          for (const room of invitations.keys()) if (!pending.has(room)) invitations.delete(room);
          for (const room of pending) if (!invitations.has(room)) invitations.set(room, -Infinity);
          lastInvitationCheck = options.clock.now();
        }
        let invitationAccepted = false;
        if (invitations.size) {
          let attempted = 0;
          for (const [room, previousAttempt] of invitations) {
            if (options.clock.now() - previousAttempt < options.reconcileMs) continue;
            if (attempted++ >= 10) break;
            invitations.set(room, options.clock.now());
            const accepted = await options.coordination.acceptInvitation(options.id, room, scope);
            if (!accepted.ok) {
              if (['forbidden', 'missing', 'conflict', 'limit'].includes(accepted.error.code)) continue;
              throw Object.assign(new Error(accepted.error.message), { code: accepted.error.code });
            }
            if (accepted.value.accepted) { invitations.delete(room); invitationAccepted = true; }
          }
        }
        const membership = new Set(await joinedRooms(client));
        const membershipChanged = membership.size !== joined.size || [...joined].some(room => !membership.has(room));
        const accessChanged = invitationAccepted || membershipChanged || options.clock.now() - lastAccess >= options.reconcileMs ? await retry(() => access(scope), scope) : false;
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
            if (!destination.turnControl) {
              state.paused = true;
              state.controls.push({ room: event.room_id, event: event.event_id, turn: null, stop: true, status: 'delivered' });
              saveControl(storage, controlFile, state);
              await publishControlNotice(client, options.coordination, options.id, options.settings, options.account, event, scope);
              continue;
            }
            const turn = await destination.turnControl.activeTurn();
            for (const earlier of state.controls) if (earlier.status === 'interrupted') earlier.status = 'superseded';
            const control = { room: event.room_id, event: event.event_id, stop: String(event.content.body).trim() === '!!',
              turn, status: 'interrupting' as const };
            state.controls.push(control);
            saveControl(storage, controlFile, state);
            if (turn) await destination.turnControl.interrupt(turn);
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
        } catch (error) {
          controlling = false;
          if (generation?.aborted && !signal.aborted) continue;
          throw error;
        }
      }
    })().catch(error => { failed.abort(error); changed(); });
    while (!signal.aborted) {
      const previous = revision;
      const generation = options.control?.current().signal;
      try {
      if (options.control && !options.control.current().active) {
        const reporter = activity; activity = undefined;
        await reporter?.close();
        await wait(previous); continue;
      }
      await startActivity();
      if (!synchronized) { await wait(previous); continue; }
      if (completed) {
        const value = completed;
        await work((client, scope) => retry(() => acknowledge(storage, client, options.cursorFile, { ...value.batch,
          cursors: Object.fromEntries(Object.entries(value.batch.cursors).filter(([room]) => !retiredRooms.has(room))),
          latest: Object.fromEntries(Object.entries(value.batch.latest).filter(([room]) => !retiredRooms.has(room))) }), scope));
        destination.acknowledge(value.messageIds); completed = undefined;
        if (value.membership !== membershipRevision) continue;
        state.controls = state.controls.filter(control => !value.batch.events.some(event => event.room_id === control.room && event.event_id === control.event));
        saveControl(storage, controlFile, state);
        if (!value.batch.more_rooms.length) { cycle = undefined; saveWake(storage, options.cursorFile); }
        if (!value.batch.more_rooms.length) await wait(previous);
        continue;
      }
      let recoveredWake = false;
      await send(async scope => { recoveredWake = await scheduled.recover(scope); });
      if (recoveredWake) continue;
      if (state.paused) { await wait(previous); continue; }
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
      if (controlled?.pending()) { await send(scope => controlled.publish(scope)); continue; }
      if (updates.pending()) { await send(scope => updates.publish(destination, scope)); continue; }
      let scheduledHandled = false;
      await send(async scope => { scheduledHandled = await scheduled.publish(scope); });
      if (scheduledHandled) continue;
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
          const now = options.clock.now();
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
      completed = { batch, messageIds: attempt.messageIds, membership: membershipAtRead };
      } catch (error) {
        if (options.control && (generation?.aborted || !options.control.current().active) && !signal.aborted) continue;
        throw error;
      }
    }
    signal.throwIfAborted();
  } finally {
    cancelBackstop();
    unsubscribe?.();
    failed.abort(new Error('Listener stopped'));
    approval?.close();
    wake?.();
    await acquisition;
    try { await activity?.close(); }
    finally { await destination.close(); }
  }
}
