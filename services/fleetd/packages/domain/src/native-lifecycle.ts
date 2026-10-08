import { failure, success, type Result, type Failure } from '@ctlflow/crossfire-kernel/result';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';
import type { RuntimeConnection, RuntimeHooks, RuntimeObservationEvent, NativeSessionState, RuntimeApproval, InputAdmission } from '@ctlflow/crossfire-agent-core/runtime';
import type { OwnedRuntimeConnection, SavedRuntimeContext } from '@ctlflow/crossfire-agent-core/owned-runtime';
import type { RuntimeAttachment } from '@ctlflow/crossfire-agent-core/terminal';
import { canRecoverFailure } from '@ctlflow/crossfire-kernel/lifecycle';
import { resumeInterruptedWork, type ResumeWorkStore } from './resume-work.js';

type Observation = Extract<RuntimeObservationEvent, { kind: 'state' }>['observation'];
type Context = { context: string; runtime: string; sessionId: string };
export type NativeLifecycleServices = {
  clock: Clock;
  hooks: RuntimeHooks;
  primary: 'shared' | 'control';
  runtime: string;
  approval: RuntimeApproval;
  initialSettings: Observation['settings'];
  initial: 'running' | 'sleeping';
  work: ResumeWorkStore;
  saved(): Promise<Result<SavedRuntimeContext[]>>;
  start(signal: AbortSignal, observe: NonNullable<RuntimeHooks['observe']>, admission?: InputAdmission): Promise<Result<OwnedRuntimeConnection>>;
  failed(sessionId: string | null, error: unknown): void;
  recovered(): void;
};

function nativeError(code: string, message: string): Error { return Object.assign(new Error(message), { code }); }

export async function createNativeLifecycle(services: NativeLifecycleServices, signal: AbortSignal) {
  const saved = await services.saved();
  if (!saved.ok) return saved;
  const interrupted = services.work.read();
  if (!interrupted.ok) return interrupted;
  let contexts = saved.value;
  let sessionId = contexts.find(context => context.context === services.primary)?.sessionId ?? '';
  if (services.initial === 'sleeping' && !sessionId) return failure('missing', 'Exact native history is missing; automatic recovery never creates a new history');
  const stop = new AbortController(), lifetime = AbortSignal.any([signal, stop.signal]);
  const observations = new Map<string, Observation>();
  const working = new Set<string>();
  const unsettled = new Set<string>();
  let phase: NativeSessionState['phase'] = 'sleeping';
  let native: OwnedRuntimeConnection | undefined, opening: Promise<OwnedRuntimeConnection> | undefined, closingNative: Promise<void> | undefined;
  let recovery: Promise<void> | undefined, closing: Promise<void> | undefined;
  let activeCalls = 0, idleSeconds = 1800, lastActivityAt = services.clock.now();
  let observationGeneration = 0;
  let cancelIdle: (() => void) | undefined;
  let failedEpisode = false;
  let inspectionUncertain = false;
  let configured = false;
  let initializationFailure: Failure | undefined;
  let activated = false, continuationReady = false, recordingWork = false;
  let activation: Promise<void> | undefined;

  function checkpoint(result: Result<void>): void {
    if (result.ok) return;
    report(nativeError(result.error.code, result.error.message));
    stop.abort(nativeError(result.error.code, result.error.message));
  }

  function report(error: unknown): void {
    if (lifetime.aborted) return;
    phase = 'failed';
    if (!failedEpisode) { failedEpisode = true; services.failed(sessionId || null, error); }
  }
  function emit(state: Observation['state'], selected = contexts, errorMessage: string | null = null): void {
    for (const context of selected) {
      const previous = observations.get(context.sessionId);
      const observation: Observation = { sessionId: context.sessionId, roomId: context.context === 'shared' || context.context === 'control' ? null : context.context,
        runtime: services.runtime, state, observedAt: services.clock.now(), settings: previous?.settings ?? services.initialSettings, errorMessage };
      observations.set(context.sessionId, observation);
      services.hooks.observe?.({ kind: 'state', observation });
    }
  }
  function schedule(): void {
    cancelIdle?.(); cancelIdle = undefined;
    if (!idleSeconds || phase !== 'running' || lifetime.aborted) return;
    cancelIdle = services.clock.schedule(() => { cancelIdle = undefined; void sleepIfIdle().catch(report); },
      Math.max(1, lastActivityAt + idleSeconds * 1000 - services.clock.now()));
  }
  function touch(): void { lastActivityAt = services.clock.now(); schedule(); }
  function observe(event: RuntimeObservationEvent): void {
    if (event.kind === 'output') touch();
    else {
      const previous = observations.get(event.observation.sessionId);
      observations.set(event.observation.sessionId, event.observation);
      if (['working', 'waiting-answer', 'waiting-approval'].includes(event.observation.state)) working.add(event.observation.sessionId);
      else if (event.observation.state === 'idle' || event.observation.state === 'sleeping') working.delete(event.observation.sessionId);
      if (recordingWork) {
        if (working.has(event.observation.sessionId)) checkpoint(services.work.capture([{ context: event.observation.roomId ?? services.primary, sessionId: event.observation.sessionId }]));
        else if (event.observation.state === 'idle') {
          const pending = services.work.read();
          if (!pending.ok) checkpoint(pending);
          else for (const item of pending.value.filter(item => item.sessionId === event.observation.sessionId)) checkpoint(services.work.acknowledge(item.messageId));
        }
      }
      if (['working', 'waiting-answer', 'waiting-approval'].includes(event.observation.state)
        || event.observation.state === 'idle' && previous && ['working', 'waiting-answer', 'waiting-approval'].includes(previous.state)) touch();
    }
    services.hooks.observe?.(event);
  }
  async function refreshContexts(): Promise<void> {
    const saved = await services.saved();
    if (!saved.ok) { initializationFailure = saved.error; throw nativeError(saved.error.code, saved.error.message); }
    const primary = saved.value.find(context => context.context === services.primary);
    if (!primary || primary.sessionId !== sessionId) {
      initializationFailure = { code: 'conflict', message: 'Saved native history changed while its listener binding was active' };
      throw nativeError(initializationFailure.code, initializationFailure.message);
    }
    contexts = saved.value;
  }
  async function discard(connection: OwnedRuntimeConnection, completed?: () => void): Promise<void> {
    if (native === connection) { native = undefined; continuationReady = false; observationGeneration++; }
    const cleanup = (async () => {
      try { await connection.close(); }
      catch { throw nativeError('conflict', 'Native process cleanup failed; replacement is blocked until cleanup is verified'); }
      completed?.();
    })();
    closingNative = cleanup;
    await cleanup;
    if (closingNative === cleanup) closingNative = undefined;
  }
  async function ensure(admission?: InputAdmission): Promise<OwnedRuntimeConnection> {
    lifetime.throwIfAborted();
    admission?.signal.throwIfAborted();
    if (closingNative) {
      if (admission) throw nativeError('unavailable', 'Exact-history shutdown is still in progress; immediate input has not been accepted');
      await closingNative;
    }
    lifetime.throwIfAborted();
    if (opening) {
      if (admission) throw nativeError('unavailable', 'Exact-history resume is already in progress; immediate input has not been accepted');
      return opening;
    }
    if (native && !native.signal.aborted && (!activated || continuationReady)) return native;
    const pending = (async () => {
      recordingWork = false;
      let connection = native;
      let opened = false;
      if (!connection || connection.signal.aborted) {
        const generation = ++observationGeneration;
        phase = 'waking';
        emit('waking', contexts.filter(context => context.context === services.primary));
        const started = await services.start(lifetime, event => {
          if (generation === observationGeneration && !lifetime.aborted) observe(event);
        }, admission);
        if (!started.ok) { initializationFailure = started.error; throw nativeError(started.error.code, started.error.message); }
        connection = started.value;
        if (lifetime.aborted) { await connection.close(); lifetime.throwIfAborted(); }
        if (sessionId && connection.sessionId !== sessionId) {
          await connection.close(); initializationFailure = { code: 'conflict', message: 'Resume returned a different native history; fresh history was not authorized' };
          throw nativeError(initializationFailure.code, initializationFailure.message);
        }
        sessionId = connection.sessionId;
        native = connection;
        opened = true;
        continuationReady = false;
        await refreshContexts();
      }
      if (connection.signal.aborted) { await discard(connection); throw connection.signal.reason ?? nativeError('native', 'Native session ended during resume'); }
      if (activated) {
        await resumeInterruptedWork(connection, services.primary, contexts, services.work);
        checkpoint(services.work.capture(contexts.filter(context => working.has(context.sessionId)).map(({ context, sessionId }) => ({ context, sessionId }))));
        continuationReady = true;
      }
      lifetime.throwIfAborted();
      phase = 'running'; touch();
      if (opened || failedEpisode) { failedEpisode = false; services.recovered(); }
      const ended = () => {
        if (native !== connection || lifetime.aborted) return;
        const error: unknown = connection.signal.reason ?? nativeError('native', 'Native session disconnected');
        report(error);
        emit('failed', contexts, (error instanceof Error ? error.message : 'Native execution failed').slice(0, 4096));
        recovery ??= (async () => {
          await discard(connection);
          emit('sleeping', contexts.filter(context => context.context !== services.primary));
          if (!canRecoverFailure(error)) return;
          for (let attempt = 0; !lifetime.aborted; attempt++) {
            try { await ensure(); return; }
            catch (error) {
              if (lifetime.aborted) return;
              report(error);
              if (!canRecoverFailure(error)) return;
              await services.clock.delay(Math.min(60000, 1000 * 2 ** Math.min(attempt, 6)), lifetime);
            }
          }
        })().catch(error => { if (!lifetime.aborted) report(error); }).finally(() => { recovery = undefined; });
      };
      if (opened) connection.signal.addEventListener('abort', ended, { once: true });
      return connection;
    })().finally(() => { recordingWork = activated; });
    opening = pending;
    try { return await pending; }
    catch (error) {
      if (native) await discard(native);
      observationGeneration++;
      report(error); throw error;
    } finally { if (opening === pending) opening = undefined; }
  }
  async function call<Value>(operation: (connection: OwnedRuntimeConnection) => Promise<Value>, activity = false, admission?: InputAdmission): Promise<Value> {
    activeCalls++;
    if (activity) touch();
    let connection: OwnedRuntimeConnection | undefined;
    try { connection = await ensure(admission); admission?.signal.throwIfAborted(); return await operation(connection); }
    catch (error) {
      if (!lifetime.aborted && connection?.signal.aborted) throw nativeError('unavailable', 'Native input is waiting for exact-history recovery');
      throw error;
    }
    finally { activeCalls--; schedule(); }
  }
  async function sleepIfIdle(): Promise<void> {
    if (!activated || lifetime.aborted || !idleSeconds || phase !== 'running' || !native) return;
    if (services.clock.now() < lastActivityAt + idleSeconds * 1000) { schedule(); return; }
    const connection = native;
    if (activeCalls || opening || unsettled.size || services.hooks.pendingDecisions?.() || services.hooks.pendingInput?.()) { touch(); return; }
    let status: { busy: boolean };
    try { status = await connection.inspect(); await refreshContexts(); }
    catch (error) {
      if (lifetime.aborted || native !== connection || connection.signal.aborted) return;
      if (!inspectionUncertain) {
        inspectionUncertain = true;
        services.failed(sessionId, error);
        for (const context of contexts) {
          const previous = observations.get(context.sessionId);
          services.hooks.observe?.({ kind: 'state', observation: { sessionId: context.sessionId,
            roomId: context.context === 'shared' || context.context === 'control' ? null : context.context,
            runtime: services.runtime, state: 'unavailable', observedAt: services.clock.now(), settings: previous?.settings ?? services.initialSettings,
            errorMessage: (error instanceof Error ? error.message : 'Native idle state could not be verified').slice(0, 4096) } });
        }
      }
      touch(); return;
    }
    if (lifetime.aborted || native !== connection || connection.signal.aborted || phase !== 'running') return;
    if (inspectionUncertain) {
      inspectionUncertain = false; services.recovered();
      for (const observation of observations.values()) services.hooks.observe?.({ kind: 'state', observation: { ...observation, observedAt: services.clock.now() } });
    }
    if (!idleSeconds || status.busy || activeCalls || unsettled.size || services.hooks.pendingDecisions?.() || services.hooks.pendingInput?.()
      || services.clock.now() < lastActivityAt + idleSeconds * 1000) { touch(); return; }
    cancelIdle?.(); cancelIdle = undefined;
    await discard(connection, () => { phase = 'sleeping'; emit('sleeping'); });
  }
  function logical(context: string, expectedSession: string): RuntimeConnection {
    async function selected(connection: OwnedRuntimeConnection, admission?: InputAdmission): Promise<RuntimeConnection> {
      const target = context === services.primary ? connection : connection.conversation ? await connection.conversation(context, admission) : undefined;
      if (!target || target.sessionId !== expectedSession) throw nativeError('conflict', 'The captured room history is not the resumed native history');
      return target;
    }
    return {
      sessionId: expectedSession, signal: lifetime, approval: services.approval,
      lifecycle: { current: () => ({ phase, lastActivityAt, historyAvailable: !!sessionId }), configureIdle: seconds => {
        if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 604800) throw new Error('Invalid native idle timeout');
        idleSeconds = seconds; schedule();
        if (!configured) { configured = true; for (const observation of observations.values()) services.hooks.observe?.({ kind: 'state', observation }); }
      } },
      inspect: async () => {
        if (!native || native.signal.aborted) return { busy: phase === 'waking' || phase === 'failed' || !!opening || activeCalls > 0 };
        return { busy: activeCalls > 0 || unsettled.size > 0 || (await native.inspect()).busy };
      },
      deliver: async (text, messageId, cancelled, priority) => {
        cancelled?.throwIfAborted();
        unsettled.add(messageId);
        await call(async connection => { cancelled?.throwIfAborted(); await (await selected(connection, priority ? { priority, signal: cancelled ?? lifetime } : undefined)).deliver(text, messageId, cancelled, priority); }, true,
          priority ? { priority, signal: cancelled ?? lifetime } : undefined);
      },
      recover: async (text, messageId, cancelled) => {
        unsettled.add(messageId);
        const received = await call(async connection => (await selected(connection)).recover(text, messageId, cancelled), true);
        if (!received) { unsettled.delete(messageId); schedule(); }
        return received;
      },
      settle: async cancelled => {
        if (!native && !services.hooks.pendingInput?.() && !services.hooks.pendingDecisions?.()) return false;
        return call(async connection => (await selected(connection)).settle(cancelled));
      },
      acknowledge: ids => {
        if (!ids.length) return;
        if (!native || native.signal.aborted) throw nativeError('unavailable', 'Exact native receipt acknowledgment is waiting for recovery');
        native.acknowledge(ids);
        for (const id of ids) unsettled.delete(id);
        schedule();
      },
      turnControl: {
        activeTurn: async (room, admission) => admission
          ? call(connection => connection.turnControl.activeTurn(room, admission), false, admission)
          : native && !native.signal.aborted ? native.turnControl.activeTurn(room) : null,
        interrupt: async (turn, recovery, admission) => call(connection => connection.turnControl.interrupt(turn, recovery, admission), true, admission),
      },
      conversation: async (room, admission) => call(async connection => {
        if (!connection.conversation) throw nativeError('invalid', 'This native runtime does not support room histories');
        const target = await connection.conversation(room, admission);
        await refreshContexts();
        return logical(room, target.sessionId);
      }, false, admission),
      close,
    };
  }
  function close(): Promise<void> {
    return closing ??= (async () => {
      const checkpoint = services.work.capture(contexts.filter(context => working.has(context.sessionId)).map(({ context, sessionId }) => ({ context, sessionId })));
      stop.abort(new Error('Native listener binding stopped'));
      cancelIdle?.(); cancelIdle = undefined;
      await opening?.catch(() => undefined);
      if (native) await discard(native);
      await closingNative;
      await recovery;
      if (!checkpoint.ok) throw nativeError(checkpoint.error.code, checkpoint.error.message);
    })();
  }
  try {
    if (services.initial === 'running' || services.hooks.pendingDecisions?.()) await ensure();
    else emit('sleeping');
    const runtime = logical(services.primary, sessionId);
    return success({ runtime, nativeState: runtime.lifecycle!.current,
      activate(): Promise<void> {
        return activation ??= (async () => {
          lifetime.throwIfAborted();
          activated = true;
          if (native || interrupted.value.length) await ensure();
          else recordingWork = true;
        })();
      },
      async resume(): Promise<Result<void>> {
        try { await call(async () => {}, true); return success(undefined); }
        catch (error) {
          return initializationFailure ? { ok: false, error: initializationFailure }
            : failure('native', error instanceof Error ? error.message : 'Exact native history could not be resumed');
        }
      },
      async contexts(): Promise<Result<Context[]>> {
        const saved = await services.saved();
        return saved.ok ? success(saved.value.map(({ context, runtime, sessionId }) => ({ context, runtime, sessionId }))) : saved;
      },
      async attachment(): Promise<Result<RuntimeAttachment>> {
        const selected = native;
        return selected && !selected.signal.aborted && phase === 'running' ? success(selected.attachment)
          : failure('conflict', 'Native session is sleeping or unavailable; resume it explicitly before attaching a terminal');
      },
      async attachments(): Promise<Result<{ context: string; attachment: RuntimeAttachment }[]>> {
        const selected = native;
        return selected && !selected.signal.aborted && phase === 'running' ? success(await selected.attachments())
          : failure('conflict', 'Native session is sleeping or unavailable; metadata inspection never wakes it');
      }, close });
  } catch (error) {
    await close();
    return initializationFailure ? { ok: false as const, error: initializationFailure } : failure('native', error instanceof Error ? error.message : 'Native listener binding could not initialize');
  }
}
