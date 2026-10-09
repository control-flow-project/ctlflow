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
import { loadControl, saveControl, sourceEvents, sourceText, isControl, publishControlNotice } from './control.js';
import { decisions } from './decisions.js';
import { ownerObservation } from './owner-observation.js';
import { INPUT_BYTES } from '@ctlflow/crossfire-contracts/runtime';
import { createListenerActivity } from './listener-activity.js';
import { requireCurrentRelease } from './release.js';
import type { Manifest } from '@ctlflow/crossfire-contracts/release';
import { isListenerNotice, mentionsAgent } from '@ctlflow/crossfire-contracts/notices';
import { deliveryEvents, resolveSenders } from './senders.js';
import { testListener, type ListenerTest } from './diagnostic.js';
import { releaseUpdates } from './updates.js';
import { controlledPublisher, waitForActivation } from './listener-control.js';
import type { ControllerBinding, ListenerControl } from './listener-control-port.js';
import type { ReadBatch } from './receive.js';
import { scheduledPublisher } from './scheduled.js';
import { chatPublication } from './chat-publication.js';
import { listenerStatistics } from './statistics.js';
import { messageArtifacts } from './message-artifacts.js';
import { historyQueries, type HistoryQueries } from './history-query.js';
import { createListenerBudget, type ListenerBudget } from './budget.js';
import { steeringReceipts } from './steering-receipts.js';
import { listenerMaintenance } from './listener-maintenance.js';

const steeringPreemptionCause = Symbol('steering-preemption');

function steeringPreempted(error: unknown): boolean {
  return error instanceof Error && error.cause === steeringPreemptionCause;
}

export type ListenerOptions = {
  clock: Clock;
  budget?: ListenerBudget;
  control: ListenerControl;
  storage: LocalState;
  transport: Transport;
  invitationRooms: (signal: AbortSignal) => Promise<readonly string[]>;
  activity?: (runId: string, binding: ControllerBinding) => void;
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
  if (!options.control || typeof options.control.binding !== 'function') throw new Error('Listeners require an authenticated fleet controller binding');
  if (!Number.isSafeInteger(options.pollMs) || options.pollMs < 100 || options.pollMs > 30_000) throw new Error('Listener polling interval must be 100..30000 ms');
  if (!Number.isSafeInteger(options.debounceMs) || options.debounceMs < 0 || options.debounceMs > 60_000) throw new Error('Listener collection interval must be 0..60000 ms');
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error('Listener message page must contain 1..100 records');
  if (!Number.isSafeInteger(options.reconcileMs) || options.reconcileMs < 1000 || options.reconcileMs > 600_000) {
    throw new Error('Listener reconciliation interval must be 1000..600000 ms');
  }
  await waitForActivation(options.control, stop);
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
  let activity: ReturnType<typeof createListenerActivity> | undefined;
  try {
  const updates = releaseUpdates(storage, options.cursorFile, options.release.release, options.settings.owner, destination.sessionId);
  const signal = AbortSignal.any([stop, destination.signal, failed.signal]);
  activity = createListenerActivity({ client: options.coordination, agentId: options.id, release: options.release, control: options.control,
    clock: options.clock, statistics, updated: release => { updates.available(release); changed(); }, failed: error => failed.abort(error),
    started: (runId, binding) => { reportingRun = runId; runReady(); approval.start(); observer.start(runId); options.activity?.(runId, binding); } }, signal);
  const client = options.transport(signal, 45_000);
  const artifacts = messageArtifacts(storage, options.cursorFile + '.messages', options.clock.now, observer.busy,
    () => new Set([...snapshotContentFiles(storage, options.cursorFile), ...chat.contentFiles(), ...priorityChat.contentFiles(), ...queries.contentFiles()]));
  const controlled = controlledPublisher({ storage, file: options.cursorFile + '.controller-input', control: options.control, runtime: destination,
    artifacts, get maximum() { return maximum; } });
  const controlFile = options.cursorFile + '.control';
  const state = loadControl(storage, controlFile, destination.sessionId);
  const receipts = steeringReceipts(options.clock.now, observer.notice);
  const receipt = receipts.publish;
  let ordinary = new AbortController();
  let since = loadSyncCursor(storage, options.cursorFile);
  let synchronized = false;
  let allowed = new Set<string>();
  let senders = new Set<string>();
  const urgentControl = () => state.controls.findLast(control => control.status === 'interrupted');
  let cycle = loadWake(storage, options.cursorFile);
  let windowEnd = 0;
  let lastAccess = -Infinity;
  let wake: (() => void) | undefined;
  let revision = 0;
  let controlling = false;
  let acquiring = false;
  let membershipRevision = 0;
  const retiredRooms = new Set<string>();
  let sending: { cancel: AbortController; done: Promise<boolean> } | undefined;
  const scheduled = scheduledPublisher({ storage, clock: options.clock, file: options.cursorFile + '.wake-input', coordination: options.coordination,
    agentId: options.id, runtime: destination, artifacts, get maximum() { return maximum; }, attachment: () => {
      const runId = activity?.runId();
      if (!runId) throw new Error('Scheduled delivery requires a reporting listener');
      return { runId, sessionId: destination.sessionId };
    } });
  let completed: { batch: ReadBatch; messageIds: string[]; membership: number } | undefined;
  const chat = chatPublication({ storage, file: options.cursorFile + '.chat-publication', settings: options.settings, runtime: destination,
    mode: options.historyMode ?? 'shared', get maximum() { return maximum; }, artifacts,
    admit: event => !state.controls.some(control => control.room === event.room_id && control.event === event.event_id && control.status === 'delivered'),
    delivered: async (room, session) => { void observer.delivered(room, session); }, count: messages => activity?.delivered(messages), traffic: statistics.delivered });
  function acceptedSteering(events: readonly ReceivedEvent[]): void {
    for (const event of events) {
      const control = state.controls.find(control => control.room === event.room_id && control.event === event.event_id);
      if (control?.status !== 'delivered') receipt(event, 'accepted');
      if (control) control.status = 'delivered';
    }
    saveControl(storage, controlFile, state);
  }
  const priorityChat = chatPublication({ storage, file: options.cursorFile + '.steering-publication', settings: options.settings, runtime: destination,
    mode: options.historyMode ?? 'shared', priority: 'steering', get maximum() { return maximum; }, artifacts,
    delivered: async (room, session) => { void observer.delivered(room, session); },
    count: messages => activity?.delivered(messages), traffic: events => { statistics.delivered(events); acceptedSteering(events); } });
  const queries = historyQueries({ storage, file: options.cursorFile, transport: options.transport, signal, coordination: options.coordination,
    account: options.account, settings: options.settings, agentId: options.id, now: options.clock.now, artifacts,
    publishing: () => acquiring || controlling || chat.pending() || priorityChat.pending() || urgentControl() !== undefined || completed !== undefined,
    observed: statistics.observed, delivered: events => { statistics.delivered(events); activity?.delivered(events.filter(event => event.type === 'm.room.message').length); },
    acknowledged: () => { cycle = undefined; saveWake(storage, options.cursorFile); windowEnd = 0; changed(); } });
  const maintenance = listenerMaintenance({ clock: options.clock, interval: options.reconcileMs, agentId: options.id,
    storage, file: options.cursorFile + '.maintenance', coordination: options.coordination, invitationRooms: options.invitationRooms });
  const changed = () => { revision++; wake?.(); };
  pendingInput = () => acquiring || controlling || sending !== undefined || completed !== undefined || chat.pending()
    || priorityChat.pending() || controlled.pending() || scheduled.pending() || queries.pending() || cycle !== undefined
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
    if (urgentControl()) throw new Error('Ordinary listener work preempted by accepted steering', { cause: steeringPreemptionCause });
    const deadline = options.clock.deadline(options.reconcileMs);
    const preempted = ordinary.signal;
    const scope = AbortSignal.any([signal, options.control.current().signal, preempted, deadline]);
    let release: (() => void) | undefined;
    try {
      release = await budget.acquire('acquisition', scope);
      return await operation(options.transport(scope, Math.min(45_000, options.reconcileMs)), scope);
    } catch (error) {
      if (preempted.aborted) throw preempted.reason;
      if (deadline.aborted && !signal.aborted) throw Object.assign(new Error('Listener acquisition exceeded its reconciliation deadline'), { code: 'unavailable' });
      throw error;
    } finally { release?.(); }
  }
  async function wait(previous: number, milliseconds = options.reconcileMs, control = false): Promise<void> {
    acquiring = false;
    signal.throwIfAborted();
    if (previous !== revision) return;
    await new Promise<void>(resolve => {
      const finish = () => { cancelTimer(); signal.removeEventListener('abort', finish); wake = undefined; resolve(); };
      const cancelTimer = options.clock.schedule(finish, !control && activity && synchronized && !state.paused
        && options.control.current().active ? Math.min(milliseconds, scheduled.waitMs()) : milliseconds);
      wake = finish;
      signal.addEventListener('abort', finish, { once: true });
    });
    signal.throwIfAborted();
  }
  async function send(operation: (scope: AbortSignal) => Promise<void>, priority = false, parent = signal): Promise<boolean> {
    if (!options.control.current().active) return false;
    if (!priority && urgentControl()) throw new Error('Ordinary listener work preempted by accepted steering', { cause: steeringPreemptionCause });
    const generation = options.control.current().signal;
    const cancel = new AbortController();
    const preempted = ordinary.signal;
    const done = (async () => {
      const scope = AbortSignal.any([cancel.signal, signal, generation, parent,
        ...(priority ? [options.clock.deadline(options.reconcileMs)] : [preempted])]);
      let release: (() => void) | undefined;
      try {
        if (!priority) release = await budget.acquire('publication', scope);
        await operation(scope);
        return true;
      } catch (error) {
        signal.throwIfAborted();
        if (cancel.signal.aborted || generation.aborted || steeringPreempted(scope.reason)) return false;
        throw error;
      } finally { release?.(); }
    })();
    sending = { cancel, done };
    try {
      const delivered = await done;
      if (preempted.aborted && steeringPreempted(preempted.reason)) throw preempted.reason;
      return delivered;
    }
    finally { sending = undefined; }
  }
  async function cancelDelivery(): Promise<void> {
    if (!sending) return;
    sending.cancel.abort(new Error('Delivery superseded by source control or membership change'));
    await sending.done;
  }
  async function preempt(): Promise<void> {
    ordinary.abort(new Error('Ordinary listener work preempted by accepted steering', { cause: steeringPreemptionCause }));
    await cancelDelivery();
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
  const unsubscribe = options.control.subscribe(() => {
    if (!options.control.current().active) {
      membershipRevision++;
      void cancelDelivery().catch(error => failed.abort(error));
    }
    changed();
  });
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
    if (options.control.current().active) await activity.activate();
    signal.throwIfAborted();
    options.ready?.(() => {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
      return testListener({ coordination: options.coordination, runtime: destination, matrix: options.transport(deadline, 10000),
        ...(approval ? { authorizeApproval: approval.authorize } : {}),
        id: options.id, owner: options.settings.owner, matrixUserId: options.account.user_id, paused: state.paused || !options.control.current().active, signal: deadline });
    }, queries);
    acquisition = (async () => {
      for (;;) {
        signal.throwIfAborted();
        await waitForActivation(options.control, signal);
        const generation = options.control.current().signal;
        const deadline = options.clock.deadline(options.reconcileMs);
        const scope = AbortSignal.any([signal, generation, deadline]);
        try {
        const client = options.transport(scope, Math.min(45_000, options.reconcileMs));
        const synced = await retry(() => synchronize(client, since, Math.min(options.pollMs, Math.floor(options.reconcileMs / 2))), scope);
        controlling = true;
        const membership = new Set(await joinedRooms(client));
        const membershipChanged = membership.size !== joined.size || [...joined].some(room => !membership.has(room));
        if (membershipChanged || options.clock.now() - lastAccess >= options.reconcileMs) await retry(() => access(scope), scope);
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
        for await (const event of sourceEvents(client, synced, since, selected)) {
          if (!joined.has(event.room_id) || !membership.has(event.room_id) || reset.has(event.room_id)) continue;
          statistics.observed([event]);
          if (state.controls.some(control => control.room === event.room_id && control.event === event.event_id)) continue;
          const candidate = mentionsAgent(event, options.account.user_id)
            || event.sender === options.settings.owner && String(event.content.body).trim() === '!!';
          if (candidate) await retry(() => access(scope), scope);
          if (!allowed.has(event.room_id)) continue;
          if (!senders.has(event.sender) && mentionsAgent(event, options.account.user_id)) maintenance.notice(event);
          if (!await isControl(client, options.settings, options.account, event, options.coordination, senders, scope)) {
            if (state.paused && sourceText(event, options.settings.owner)) { state.paused = false; changed(); }
            continue;
          }
          {
            const [attributed] = await eventOrigins(client, options.account.user_id, [event]);
            const source = attributed!;
            receipt(source, 'received');
            const previousPublication = preempt();
            void previousPublication.catch(error => failed.abort(error));
            if (!destination.turnControl) {
              await previousPublication;
              receipt(source, 'failed', 'This runtime has no captured-turn interruption capability');
              state.paused = true;
              state.controls.push({ room: event.room_id, event: event.event_id, turn: null, stop: true, status: 'delivered' });
              saveControl(storage, controlFile, state);
              await publishControlNotice(client, options.coordination, options.id, options.settings, options.account, event, scope);
              continue;
            }
            let turn: string | null;
            try { turn = await destination.turnControl.activeTurn(options.historyMode === 'per-room' ? event.room_id : undefined,
              { priority: 'steering', signal: scope }); }
            catch (error) { receipt(source, 'failed', error instanceof Error ? error.message : 'Native turn capture failed'); throw error; }
            await retry(() => access(scope), scope);
            if (!allowed.has(event.room_id) || !await isControl(client, options.settings, options.account, event, options.coordination, senders, scope)) {
              receipt(source, 'failed', 'Source or room authority changed before cancellation'); continue;
            }
            scope.throwIfAborted();
            for (const earlier of state.controls) if (earlier.status === 'interrupted'
              && (options.historyMode !== 'per-room' || earlier.room === event.room_id)) {
              earlier.status = 'superseded'; receipts.superseded(earlier.room, earlier.event, source);
            }
            const control = { room: event.room_id, event: event.event_id, stop: event.sender === options.settings.owner && String(event.content.body).trim() === '!!',
              turn, status: 'interrupting' as const };
            state.controls.push(control);
            saveControl(storage, controlFile, state);
            try {
              const outcome = turn ? await destination.turnControl.interrupt(turn, false, { priority: 'steering', signal: scope }) : 'inactive';
              receipt(source, outcome === 'interrupted' ? 'interrupted' : 'already-idle');
            } catch (error) { receipt(source, 'failed', error instanceof Error ? error.message : 'Native interruption failed'); throw error; }
            await previousPublication;
            const saved = state.controls.at(-1)!;
            saved.status = saved.stop ? 'delivered' : 'interrupted';
            state.paused = saved.stop;
            saveControl(storage, controlFile, state);
          }
        }
        joined = membership;
        controlling = false;
        maintenance.observe(synced);
        saveControl(storage, controlFile, state);
        checkpointSync(storage, options.cursorFile, synced.next_batch);
        since = synced.next_batch;
        synchronized = true;
        if (ordinary.signal.aborted) ordinary = new AbortController();
        changed();
        } catch (error) {
          controlling = false;
          if (ordinary.signal.aborted) ordinary = new AbortController();
          changed();
          if (generation.aborted && !signal.aborted) continue;
          if (state.controls.some(control => control.status === 'interrupting')) throw error;
          if ((deadline.aborted || retryable(error)) && !signal.aborted) { await options.clock.delay(Math.min(options.pollMs, 5000), signal); continue; }
          throw error;
        }
      }
    })().catch(error => { failed.abort(error); changed(); });
    while (!signal.aborted) {
      artifacts.cleanup();
      const previous = revision;
      const generation = options.control.current().signal;
      try {
      if (!options.control.current().active) {
        await activity.pause();
        await wait(previous); continue;
      }
      if (!await activity.activate() || generation.aborted) continue;
      if (!synchronized) { await wait(previous); continue; }
      if (controlling && (!completed || ordinary.signal.aborted || urgentControl())) { await wait(previous, options.reconcileMs, true); continue; }
      if (!controlling && priorityChat.pending()) {
        let recovered: Awaited<ReturnType<typeof priorityChat.recover>>;
        await send(async scope => { recovered = await priorityChat.recover(new Set([...allowed].filter(room => joined.has(room))), scope); }, true);
        if (recovered) {
          acceptedSteering(recovered.batch.events);
          destination.acknowledge(recovered.messageIds); priorityChat.acknowledge(); continue;
        }
        if (priorityChat.recovering()) continue;
        const current = urgentControl();
        if (!current || !priorityChat.events().some(event => event.room_id === current.room && event.event_id === current.event)) {
          priorityChat.discardUnpublished(); continue;
        }
      }
      const urgent = !controlling && !state.paused && urgentControl();
      if (urgent) {
        const scope = AbortSignal.any([signal, generation, ordinary.signal, options.clock.deadline(options.reconcileMs)]);
        const urgentClient = options.transport(scope, Math.min(30_000, options.reconcileMs));
        let source: ReceivedEvent | undefined;
        try {
          const event = await urgentClient.get<Event>(`${API}/rooms/${segment(urgent.room)}/event/${segment(urgent.event)}`);
          if (event.event_id !== urgent.event) throw new Error('Urgent event identity changed');
          source = eventView(event, urgent.room);
          await access(scope);
          if (!joined.has(urgent.room) || !allowed.has(urgent.room)
            || !await isControl(urgentClient, options.settings, options.account, source, options.coordination, senders, scope)) {
            receipt(source, 'failed', 'Source or room authority changed before native input');
            urgent.status = 'superseded'; saveControl(storage, controlFile, state); continue;
          }
          if (controlling || state.paused || urgent.status !== 'interrupted' || urgentControl() !== urgent) continue;
          if (!priorityChat.pending()) {
            const events = await eventOrigins(urgentClient, options.account.user_id, [source]);
            const identities = await resolveSenders(options.coordination, events, scope);
            scope.throwIfAborted();
            priorityChat.prepare({ events, cursors: {}, latest: {}, more_rooms: [] }, events, identities);
          }
          let published: Awaited<ReturnType<typeof priorityChat.publish>>;
          await send(async scope => { published = await priorityChat.publish(new Set([...allowed].filter(room => joined.has(room))), scope); }, true, scope);
          if (published) { destination.acknowledge(published.messageIds); priorityChat.acknowledge(); }
        } catch (error) {
          if (steeringPreempted(scope.reason)) throw scope.reason;
          if (source) receipt(source, 'failed', error instanceof Error ? error.message : 'Native input acceptance failed'); throw error;
        }
        continue;
      }
      if (queries.recovering()) await work((_client, scope) => retry(() => queries.recover(scope), scope));
      if (queries.pending()) { await wait(previous, 1000); continue; }
      if (completed) {
        const value = completed;
        await work((client, scope) => retry(() => acknowledge(storage, client, options.cursorFile, { ...value.batch,
          cursors: Object.fromEntries(Object.entries(value.batch.cursors).filter(([room]) => !retiredRooms.has(room))),
          latest: Object.fromEntries(Object.entries(value.batch.latest).filter(([room]) => !retiredRooms.has(room))) }), scope));
        destination.acknowledge(value.messageIds); chat.acknowledge(); completed = undefined;
        if (value.membership !== membershipRevision) continue;
        state.controls = state.controls.filter(control => !['delivered', 'superseded'].includes(control.status)
          || !value.batch.events.some(event => event.room_id === control.room && event.event_id === control.event));
        saveControl(storage, controlFile, state);
        if (!value.batch.more_rooms.length) { cycle = undefined; saveWake(storage, options.cursorFile); }
        if (!value.batch.more_rooms.length) await wait(previous);
        continue;
      }
      let recoveredWake = false;
      if (scheduled.pending()) await send(async scope => { recoveredWake = await scheduled.recover(scope); });
      if (recoveredWake) continue;
      if (chat.recovering()) {
        let recovered: Awaited<ReturnType<typeof chat.recover>>;
        await send(async scope => { recovered = await chat.recover(new Set([...allowed].filter(room => joined.has(room))), scope); });
        if (recovered) { completed = { ...recovered, membership: membershipRevision }; continue; }
      }
      if (state.paused) { await wait(previous); continue; }
      retiredRooms.clear();
      if (chat.pending()) {
        let published: Awaited<ReturnType<typeof chat.publish>>;
        const accepted = await send(async scope => { published = await chat.publish(new Set([...allowed].filter(room => joined.has(room))), scope); });
        if (accepted && published) completed = { ...published, membership: membershipRevision };
        continue;
      }
      if (controlled.pending()) { await send(scope => controlled.publish(scope)); continue; }
      if (updates.pending() && (!destination.lifecycle || destination.lifecycle.current().phase === 'running')) { await send(scope => updates.publish(destination, scope)); continue; }
      let scheduledHandled = false;
      if (scheduled.due()) await send(async scope => { scheduledHandled = await scheduled.publish(scope); });
      if (scheduledHandled) continue;
      if (maintenance.pending()) {
        const accepted = await work((_client, scope) => retry(() => maintenance.publish(scope), scope));
        if (accepted) { lastAccess = -Infinity; changed(); }
      }
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
      if (!senders.size) { windowEnd = 0; acquiring = false; await wait(previous); continue; }
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
          if (now < windowEnd) { acquiring = false; await wait(previous, Math.ceil(windowEnd - now)); continue; }
          cycle = await work(client => captureWake(client, trigger,
            new Set(Object.keys(batch.cursors).filter(room => allowed.has(room) && (!selected || room === selected)
              && (options.historyMode !== 'per-room' || room === trigger.room_id))), since!));
          saveWake(storage, options.cursorFile, cycle); windowEnd = 0;
        } else if (pending.length) { windowEnd = 0; acquiring = false; await wait(previous); continue; }
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
      const { emitted, identities } = await work(async (client, scope) => {
        const emitted = await eventOrigins(client, options.account.user_id, deliveryEvents(events, options.account.user_id));
        return { emitted, identities: await resolveSenders(options.coordination, emitted, scope) };
      });
      if (membershipAtRead !== membershipRevision || controlling || state.paused || urgentControl() || queries.pending()
        || cursorsAtRead !== JSON.stringify(loadCursors(storage, options.cursorFile))) continue;
      chat.prepare(batch, emitted, identities);
      } finally { acquiring = false; }
      } catch (error) {
        if (steeringPreempted(error)) continue;
        if ((generation.aborted || !options.control.current().active) && !signal.aborted) continue;
        if (retryable(error) && !signal.aborted) { await options.clock.delay(Math.min(options.pollMs, 5000), signal); continue; }
        throw error;
      }
    }
    signal.throwIfAborted();
  } finally {
    cancelBackstop();
    unsubscribe();
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
