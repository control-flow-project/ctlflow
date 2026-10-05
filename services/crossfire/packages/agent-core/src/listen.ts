import type { Clock, LocalState, Transport } from './port.js';
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import type { Matrix } from './port.js';
import { selectRoom } from '@ctlflow/crossfire-contracts/validation';
import type { Account, Settings, Event } from '@ctlflow/crossfire-contracts/client';
import type { Coordination } from './coordination.js';
import { synchronize, loadSyncCursor, loadCursors, checkpointSync, membershipResets, acknowledge, flushAcknowledgements, retainJoinedCursors, eventView, joinedRooms, type ReceivedEvent } from './receive.js';
import { captureWake, collectBatch, pendingBatch, wakeEvent, loadWake, saveWake, retireSnapshot, snapshotContentFiles } from './delivery.js';
import { eventOrigins } from './origins.js';
import type { RuntimeAdapter } from './runtime.js';
import { loadControl, saveControl, humanEvents, humanText, isControl, publishControlNotice } from './control.js';
import { decisions } from './decisions.js';
import { ownerObservation } from './owner-observation.js';
import { INPUT_BYTES } from '@ctlflow/crossfire-contracts/runtime';
import { reportActivity } from './activity.js';
import { requireCurrentRelease } from './release.js';
import type { Manifest } from '@ctlflow/crossfire-contracts/release';
import { isListenerNotice, mentionsAgent } from '@ctlflow/crossfire-contracts/notices';
import { incrementalEvents } from './receive.js';
import { deliveryEvents, resolveSenders } from './senders.js';
import { testListener, type ListenerTest } from './diagnostic.js';
import { releaseUpdates } from './updates.js';
import { controlledPublisher, waitForActivation } from './listener-control.js';
import type { ListenerControl } from './listener-control-port.js';
import type { ReadBatch } from './receive.js';
import { scheduledPublisher } from './scheduled.js';
import { chatPublication } from './chat-publication.js';
import { chatBatches } from './chat-batches.js';
import { listenerStatistics } from './statistics.js';
import { messageArtifacts } from './message-artifacts.js';
import { historyQueries, type HistoryQueries } from './history-query.js';
import { createListenerBudget, type ListenerBudget } from './budget.js';

export type ListenerOptions = {
  clock: Clock;
  budget?: ListenerBudget;
  control?: ListenerControl;
  storage: LocalState;
  transport: Transport;
  invitationRooms: (signal: AbortSignal) => Promise<readonly string[]>;
  ready?: (test: () => Promise<ListenerTest>, queries: HistoryQueries) => void;
  release: Manifest;
  coordination: Coordination;
  settings: Settings;
  account: Account;
  cursorFile: string;
  room?: string;
  limit: number;
  historyMode?: 'shared' | 'per-room';
  pollMs: number;
  debounceMs: number;
  runtime: RuntimeAdapter;
  id: string;
  reconcileMs: number;
};

function retryable(error: unknown): boolean {
  if (error instanceof Error && 'status' in error && typeof error.status === 'number') return error.status === 429 || error.status >= 500;
  return error instanceof Error && 'code' in error
    && ['native', 'unavailable', 'body_too_large', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(String(error.code));
}

export async function listen(options: ListenerOptions, stop: AbortSignal): Promise<void> {
  const storage = options.storage;
  const budget = options.budget ?? createListenerBudget();
  if (!Number.isSafeInteger(options.reconcileMs) || options.reconcileMs < 1000 || options.reconcileMs > 600_000) {
    throw new Error('Listener reconciliation interval must be 1000..600000 ms');
  }
  const current = await requireCurrentRelease(options.coordination, options.release, stop);
  if (!current.ok) throw Object.assign(new Error(current.error.message), { code: current.error.code });
  const failed = new AbortController();
  const lifetime = AbortSignal.any([stop, failed.signal]);
  const statistics = listenerStatistics(options.account.user_id, options.clock.now);
  let maximum = INPUT_BYTES;
  let pendingInput = () => true;
  let destination: Awaited<ReturnType<RuntimeAdapter>>;
  let reportingRun: string | undefined;
  let runReady!: () => void;
  const reporting = new Promise<void>(resolve => { runReady = resolve; });
  const observer = ownerObservation({ agentId: options.id, userId: options.account.user_id, file: options.cursorFile + '.observation', storage,
    clock: options.clock, transport: options.transport, coordination: options.coordination, historyMode: options.historyMode ?? 'shared', get maximum() { return maximum; },
    native: () => destination?.lifecycle?.current() }, lifetime);
  const approval = decisions({
    client: options.transport(lifetime, 45_000),
    clock: options.clock,
    coordination: options.coordination, settings: options.settings, matrixUserId: options.account.user_id, agent: options.id,
    run: async () => { await reporting; lifetime.throwIfAborted(); if (!reportingRun) throw new Error('Listener reporting is not ready'); return reportingRun; },
    storage, file: options.cursorFile + '.decisions',
  }, lifetime);
  try {
    destination = await options.runtime(lifetime, options.pollMs, {
      observe: observer.observe,
      usage: statistics.usage,
      decisionResponded: approval.responded,
      pendingDecisions: approval.unresolved,
      pendingInput: () => pendingInput(),
      requestDecision: async (permission, cancelled) => {
        return approval.request(permission, cancelled);
      },
    });
  } catch (error) { failed.abort(error); runReady(); await approval.close(); await observer.close(); throw error; }
  let activity: Awaited<ReturnType<typeof reportActivity>> | undefined;
  try {
  const updates = releaseUpdates(storage, options.cursorFile, options.release.release, options.settings.owner, destination.sessionId);
  const signal = AbortSignal.any([stop, destination.signal, failed.signal]);
  const client = options.transport(signal, 45_000);
  const artifacts = messageArtifacts(storage, options.cursorFile + '.messages', options.clock.now, observer.busy,
    () => new Set([...snapshotContentFiles(storage, options.cursorFile), ...chat.contentFiles(), ...queries.contentFiles()]));
  const controlled = options.control ? controlledPublisher({ storage, file: options.cursorFile + '.controller-input', control: options.control, runtime: destination,
    artifacts, get maximum() { return maximum; } }) : undefined;
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
  let acquiring = false;
  let waitingForControl = false;
  let membershipRevision = 0;
  const retiredRooms = new Set<string>();
  let sending: { cancel: AbortController; done: Promise<boolean> } | undefined;
  const scheduled = scheduledPublisher({ storage, clock: options.clock, file: options.cursorFile + '.wake-input', coordination: options.coordination,
    agentId: options.id, runtime: destination, artifacts, get maximum() { return maximum; }, attachment: () => {
      if (!activity) throw new Error('Scheduled delivery requires a reporting listener');
      return { runId: activity.runId, sessionId: destination.sessionId };
    } });
  let completed: { batch: ReadBatch; messageIds: string[]; membership: number } | undefined;
  const chat = chatPublication({ storage, file: options.cursorFile + '.chat-publication', settings: options.settings, runtime: destination,
    mode: options.historyMode ?? 'shared', get maximum() { return maximum; }, artifacts, delivered: observer.delivered, count: messages => activity?.delivered(messages), traffic: statistics.delivered });
  const queries = historyQueries({ storage, file: options.cursorFile, matrix: client, coordination: options.coordination,
    account: options.account, settings: options.settings, agentId: options.id, now: options.clock.now, artifacts,
    publishing: () => acquiring || chat.pending() || completed !== undefined,
    observed: statistics.observed, delivered: events => { statistics.delivered(events); activity?.delivered(events.filter(event => event.type === 'm.room.message').length); },
    acknowledged: () => { cycle = undefined; saveWake(storage, options.cursorFile); windowEnd = 0; changed(); } });
  let pendingMessages = 0;
  const invitations = new Map<string, number>();
  let lastInvitationCheck = -Infinity;
  const changed = () => { revision++; wake?.(); };
  pendingInput = () => acquiring || controlling || sending !== undefined || completed !== undefined || chat.pending()
    || !!controlled?.pending() || scheduled.pending() || queries.pending() || cycle !== undefined
    || state.controls.some(control => control.status === 'interrupting' || control.status === 'interrupted');
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
    const base = AbortSignal.any([signal, ...(options.control ? [options.control.current().signal] : [])]);
    const release = await budget.acquire('acquisition', base);
    const deadline = options.clock.deadline(options.reconcileMs);
    const scope = AbortSignal.any([base, deadline]);
    try {
      return await operation(options.transport(scope, Math.min(45_000, options.reconcileMs)), scope);
    } catch (error) {
      if (deadline.aborted && !signal.aborted) throw Object.assign(new Error('Listener acquisition exceeded its reconciliation deadline'), { code: 'unavailable' });
      throw error;
    } finally { release(); }
  }
  async function wait(previous: number, milliseconds = options.reconcileMs, control = false): Promise<void> {
    acquiring = false;
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
      const scope = AbortSignal.any([cancel.signal, signal, ...(options.control ? [options.control.current().signal] : [])]);
      const release = await budget.acquire('publication', scope);
      try {
        await operation(scope);
        return true;
      } catch (error) {
        signal.throwIfAborted();
        if (cancel.signal.aborted || generation?.aborted) return false;
        throw error;
      } finally { release(); }
    })();
    sending = { cancel, done };
    try { return await done; }
    finally { sending = undefined; }
  }
  async function deliver(events: readonly ReceivedEvent[]): Promise<{ accepted: boolean; messageIds: string[] }> {
    if (!senders.size) return { accepted: false, messageIds: [] };
    let messageIds: string[] = [];
    const accepted = await send(async scope => {
      const emitted = await eventOrigins(options.transport(scope, 30000), options.account.user_id, deliveryEvents(events, options.account.user_id));
      const identities = await resolveSenders(options.coordination, emitted, scope);
      const batches = chatBatches(emitted, options.settings, identities, maximum, options.historyMode ?? 'shared', artifacts);
      messageIds = batches.map(batch => batch.messageId);
      for (const batch of batches) {
        pendingMessages = batch.messages;
        const target = batch.room && destination.conversation ? await destination.conversation(batch.room) : destination;
        if (batch.room && !destination.conversation) throw new Error('The selected native runtime does not support room histories');
        await target.deliver(batch.text, batch.messageId, scope);
        statistics.delivered(batch.events);
        const lastRoom = batch.events.findLast(event => event.type === 'm.room.message')?.room_id;
        if (lastRoom) await observer.delivered(lastRoom, target.sessionId);
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
    maximum = view.maxMessageBytes;
    destination.lifecycle?.configureIdle(view.fleetIdleTimeoutSeconds);
    if (view.agentId !== options.id || view.matrixUserId !== options.account.user_id || view.ownerMatrixId !== options.settings.owner
      || view.status !== 'active' || view.ownerStatus !== 'active') throw Object.assign(new Error('Agent or owner access is no longer active'), { code: 'forbidden' });
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
    try { activity = await reportActivity(options.coordination, options.id, options.release, signal, !!options.control, options.clock, statistics, release => { updates.available(release); changed(); }); }
    catch (error) { throw error; }
    activity.signal.addEventListener('abort', () => failed.abort(activity?.signal.reason), { once: true });
    if (activity.signal.aborted) failed.abort(activity.signal.reason);
    reportingRun = activity.runId; runReady(); approval.start(); observer.start(activity.runId);
  }
  try {
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
    }, queries);
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
        let humanCount = 0;
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
        for await (const event of humanEvents(client, options.settings, synced, since, selected)) {
          if (!allowed.has(event.room_id)) continue;
          humanCount++;
          if (!joined.has(event.room_id) || !membership.has(event.room_id) || reset.has(event.room_id)) continue;
          if (state.controls.some(control => control.room === event.room_id && control.event === event.event_id)) continue;
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
            const turn = await destination.turnControl.activeTurn(options.historyMode === 'per-room' ? event.room_id : undefined);
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
          for await (const event of incrementalEvents(client, synced, since, room, { types: ['m.room.message'] })) {
          statistics.observed([eventView(event, room)]);
          if (!senders.has(event.sender) && mentionsAgent(event, options.account.user_id)) {
            const notice = await options.coordination.notice(options.id, room, event.event_id, scope);
            if (!notice.ok) throw Object.assign(new Error(notice.error.message), { code: notice.error.code });
          }
          }
        }
        saveControl(storage, controlFile, state);
        checkpointSync(storage, options.cursorFile, synced.next_batch);
        since = synced.next_batch;
        const initial = !synchronized;
        synchronized = true;
        controlling = false;
        if (initial || waitingForControl || accessChanged || reset.size || humanCount
          || Object.values(synced.rooms?.join ?? {}).some(room => (room.timeline?.events.length ?? 0) > 0)) changed();
        });
        } catch (error) {
          controlling = false;
          if (generation?.aborted && !signal.aborted) continue;
          if (retryable(error) && !signal.aborted) { await options.clock.delay(Math.min(options.pollMs, 5000), signal); continue; }
          throw error;
        }
      }
    })().catch(error => { failed.abort(error); changed(); });
    while (!signal.aborted) {
      artifacts.cleanup();
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
      await work((_client, scope) => retry(() => queries.recover(), scope));
      if (queries.pending()) { await wait(previous, 1000); continue; }
      if (completed) {
        const value = completed;
        await work((client, scope) => retry(() => acknowledge(storage, client, options.cursorFile, { ...value.batch,
          cursors: Object.fromEntries(Object.entries(value.batch.cursors).filter(([room]) => !retiredRooms.has(room))),
          latest: Object.fromEntries(Object.entries(value.batch.latest).filter(([room]) => !retiredRooms.has(room))) }), scope));
        destination.acknowledge(value.messageIds); chat.acknowledge(); completed = undefined;
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
      if (chat.pending()) {
        const recovered = await chat.recover(new Set([...allowed].filter(room => joined.has(room))));
        if (recovered) { completed = { ...recovered, membership: membershipRevision }; continue; }
      }
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
          artifacts.release(attempt.messageIds);
        }
        continue;
      }
      retiredRooms.clear();
      if (chat.pending()) {
        let published: Awaited<ReturnType<typeof chat.publish>>;
        const accepted = await send(async scope => { published = await chat.publish(new Set([...allowed].filter(room => joined.has(room))), scope); });
        if (accepted && published) completed = { ...published, membership: membershipRevision };
        continue;
      }
      if (controlled?.pending()) { await send(scope => controlled.publish(scope)); continue; }
      if (updates.pending() && (!destination.lifecycle || destination.lifecycle.current().phase === 'running')) { await send(scope => updates.publish(destination, scope)); continue; }
      let scheduledHandled = false;
      await send(async scope => { scheduledHandled = await scheduled.publish(scope); });
      if (scheduledHandled) continue;
      if (cycle && (!allowed.has(cycle.room) || !joined.has(cycle.room) || !senders.has(cycle.sender))) {
        cycle = undefined; saveWake(storage, options.cursorFile); windowEnd = 0;
      }
      const membershipAtRead = membershipRevision;
      const cursorsAtRead = JSON.stringify(loadCursors(storage, options.cursorFile));
      acquiring = true;
      try {
      let batch = await work((client, scope) => retry(() => pendingBatch(storage, client, options.settings, options.cursorFile, options.limit,
        selected, maximum, since, allowed, cycle, artifacts), scope));
      statistics.observed(batch.events);
      if (membershipAtRead !== membershipRevision || controlling || state.paused || urgentControl()) continue;
      if (!senders.size) { windowEnd = 0; await wait(previous); continue; }
      async function accept(event: ReceivedEvent): Promise<boolean> {
        if (isListenerNotice(event)) return false;
        if (event.sender === options.account.user_id && event.type === 'm.room.message') return false;
        if (state.controls.some(control => control.room === event.room_id && control.event === event.event_id && control.status === 'delivered')) return false;
        return true;
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
            new Set(Object.keys(batch.cursors).filter(room => allowed.has(room) && (!selected || room === selected)
              && (options.historyMode !== 'per-room' || room === trigger.room_id))), since!));
          saveWake(storage, options.cursorFile, cycle); windowEnd = 0;
        } else if (pending.length) { windowEnd = 0; await wait(previous); continue; }
      }
      if (cycle) {
        const eligible = options.historyMode === 'per-room' ? new Set(Object.keys(cycle.ends).filter(room => allowed.has(room))) : allowed;
        if (options.historyMode === 'per-room') batch = { events: batch.events.filter(event => eligible.has(event.room_id)),
          cursors: { ...loadCursors(storage, options.cursorFile), ...Object.fromEntries(Object.entries(batch.cursors).filter(([room]) => eligible.has(room))) },
          latest: Object.fromEntries(Object.entries(batch.latest).filter(([room]) => eligible.has(room))), more_rooms: batch.more_rooms.filter(room => eligible.has(room)) };
        batch = await work(client => collectBatch(storage, client, options.settings, options.cursorFile, options.limit, maximum, batch, cycle!, eligible, artifacts));
      }
      if (membershipAtRead !== membershipRevision || controlling || state.paused || urgentControl()) continue;
      const events: ReceivedEvent[] = [];
      for (const event of batch.events) if (await accept(event)) events.push(event);
      const emitted = await eventOrigins(client, options.account.user_id, deliveryEvents(events, options.account.user_id));
      const identities = await resolveSenders(options.coordination, emitted, signal);
      if (membershipAtRead !== membershipRevision || controlling || state.paused || urgentControl() || queries.pending()
        || cursorsAtRead !== JSON.stringify(loadCursors(storage, options.cursorFile))) continue;
      chat.prepare(batch, emitted, identities);
      } finally { acquiring = false; }
      } catch (error) {
        if (options.control && (generation?.aborted || !options.control.current().active) && !signal.aborted) continue;
        if (retryable(error) && !signal.aborted) { await options.clock.delay(Math.min(options.pollMs, 5000), signal); continue; }
        throw error;
      }
    }
    signal.throwIfAborted();
  } finally {
    cancelBackstop();
    unsubscribe?.();
    failed.abort(new Error('Listener stopped'));
    runReady();
    wake?.();
    await acquisition;
  }
  } finally {
    failed.abort(new Error('Listener stopped'));
    runReady();
    try { await approval.close(); await observer.close(); await activity?.close(); }
    finally { await destination.close(); }
  }
}
