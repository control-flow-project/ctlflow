import { roomContext, contextRoom, validHistoryContext } from '@ctlflow/crossfire-kernel/history-context';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { OwnedRuntimeInput, NativeActivity, NativeContextActivity } from '@ctlflow/crossfire-agent-core/owned-runtime';
import type { InputAdmission } from '@ctlflow/crossfire-agent-core/runtime';
import { captureHistory } from '@ctlflow/crossfire-adapter-runtime/native-file';
import { deliveryJournalExists, readDeliveryJournal } from '@ctlflow/crossfire-adapter-runtime/journal';
import { failure, failureError } from '@ctlflow/crossfire-kernel/result';
import { piState, allocatePi, initializePiBinding, piHistory, verifyPiHistory, instructionDigest, verifyInstructions, flushPiHistory } from './state.js';
import { startPi, record, type PiProcess } from './protocol.js';
import { admitPi } from './admission.js';
import { piDelivery, type PiConnection } from './connection.js';
import { piInput } from './input.js';
import { piObservation } from './observation.js';
import { answerPiQuestion, piQuestion } from './questions.js';
import { piUsage } from './usage.js';
import { piErrorText } from './errors.js';

export function piHistories(input: OwnedRuntimeInput, home: string, binary: string, stop: AbortSignal) {
  const stored = piState(home), mode = input.listenerOptions?.historyMode ?? 'shared';
  const primary = mode === 'shared' ? 'shared' : 'control';
  const retained = (context: string) => stored.state.bindings.find(value => value.context === context);
  const receiptFile = (context: string) => join(home, 'receipts', createHash('sha256').update(context).digest('hex') + '.json');
  const failed = new AbortController(), lifetime = AbortSignal.any([stop, failed.signal]);
  const opened = new Map<string, PiConnection>(), starting = new Map<string, Promise<PiConnection>>();
  const contexts = () => stored.state.bindings.map(value => value.context);
  function unacknowledged(context: string): boolean {
    const file = receiptFile(context), binding = retained(context);
    if (!deliveryJournalExists(file)) return false;
    if (!binding?.sessionId) throw new Error('Pi publication journal has no exact native history');
    const journal = readDeliveryJournal(file, binding.sessionId, piInput);
    return journal.pending !== null || journal.confirmed.length > 0;
  }
  if (stored.state.mode !== mode) {
    if (input.hooks.pendingDecisions?.() || contexts().some(unacknowledged)) throw failureError({ code: 'conflict', message: 'Resolve original Pi decisions and acknowledge native publications before changing history mode' });
  }
  const existing = lstatSync(stored.file, { throwIfNoEntry: false });
  const changing = existing && stored.state.mode !== mode && retained(stored.state.mode === 'shared' ? 'shared' : 'control');
  if (!retained(primary) && !changing && (!input.allowNewHistory || existing)) {
    throw failureError({ code: 'missing', message: 'Saved Pi history is missing; resume cannot create a new history. Use explicit fresh history if intended.' });
  }
  async function open(context: string, admission?: InputAdmission): Promise<PiConnection> {
    admission?.signal.throwIfAborted(); lifetime.throwIfAborted();
    if (opened.has(context)) return opened.get(context)!;
    if (starting.has(context)) {
      if (admission) throw failureError({ code: 'unavailable', message: 'Exact Pi room history is opening; immediate input has not been accepted' });
      return starting.get(context)!;
    }
    if (!validHistoryContext(context)) throw new Error('Invalid Pi context');
    const initialization = new AbortController(), cancelled = () => initialization.abort(admission?.signal.reason);
    admission?.signal.addEventListener('abort', cancelled, { once: true });
    const scope = AbortSignal.any([lifetime, initialization.signal]);
    const pending = (async () => {
      let binding = retained(context);
      if (!binding) {
        if (stored.state.bindings.length >= 2002) throw new Error('Pi room history budget is exhausted');
        binding = allocatePi(context); stored.state.bindings.push(binding); stored.save();
      }
      initializePiBinding(home, binding, input.workspace); stored.save();
      const history = piHistory(home, binding), expected = binding.sessionId;
      let native: PiProcess | undefined, connection: PiConnection | undefined;
      let sessionId = expected ?? '', run = new AbortController(), fault: unknown, interrupted = false;
      const hooks = { ...input.hooks, observe: (event: Parameters<NonNullable<typeof input.hooks.observe>>[0]) => input.hooks.observe?.(event.kind === 'state'
        ? { ...event, observation: { ...event.observation, roomId: contextRoom(context) } } : event) };
      const observation = piObservation(hooks, () => sessionId);
      const usage = piUsage(hooks, () => sessionId);
      const questions = new Set<Promise<void>>();
      try {
        native = await startPi({ binary, home, workspace: input.workspace, stateDirectory: input.stateDirectory, profile: input.profile,
          sessionFile: history, instructions: input.instructions, event: event => {
            connection?.changed();
            usage.event(event);
            if (event.type === 'extension_error') throw new Error(piErrorText('Native Pi extension failed: ' + String(event.error)));
            if (event.type === 'agent_start') { run = new AbortController(); fault = undefined; interrupted = false; }
            if (event.type === 'interruption_started') { interrupted = true; run.abort(new Error('The original Pi execution was interrupted')); }
            if (event.type === 'message_end') {
              const message = record(event.message);
              if (message.role === 'assistant') fault = message.stopReason === 'error' ? new Error(piErrorText(String(message.errorMessage ?? 'Pi execution failed'))) : undefined;
            }
            if (event.type === 'agent_settled') {
              run.abort(new Error('The original Pi execution ended'));
              if (fault && !interrupted) { observation.state('failed', String(fault instanceof Error ? fault.message : fault)); native?.fail(fault); return; }
            }
            if (event.type === 'extension_ui_request' && ['confirm', 'select', 'input', 'editor'].includes(String(event.method))) {
              if (!native || !connection) throw new Error('Pi requested human input before native readiness');
              const owner = native, target = connection, questionScope = AbortSignal.any([scope, owner.signal, run.signal]);
              observation.state('waiting-answer');
              const question = (async () => {
                const turn = await target.turnControl.activeTurn();
                if (!turn) throw new Error('Pi question has no original active execution');
                const decision = piQuestion(event, sessionId, turn);
                const signal = decision.expiresMs == null ? questionScope : AbortSignal.any([questionScope, AbortSignal.timeout(decision.expiresMs)]);
                try { await answerPiQuestion(owner, hooks, decision, signal); }
                catch (error) {
                  if (questionScope.aborted || !signal.aborted) throw error;
                  await owner.notify({ type: 'extension_ui_response', id: decision.request, cancelled: true });
                }
                if (!questionScope.aborted) observation.state('working');
              })().catch(error => { if (!questionScope.aborted) owner.fail(error); }).finally(() => { questions.delete(question); });
              questions.add(question);
            } else if (sessionId) observation.event(event);
          } }, scope);
        const selected = await admitPi(native, input.options);
        const id = selected.state.sessionId;
        if (typeof id !== 'string' || expected !== null && id !== expected || selected.state.sessionFile !== history) throw new Error('Pi substituted its native session identity or path');
        sessionId = id; verifyPiHistory(history, input.workspace, sessionId); flushPiHistory(history);
        if (stored.state.bindings.some(value => value !== binding && value.sessionId === sessionId)) throw new Error('Pi reused another native context identity');
        binding.sessionId = sessionId; stored.state.mode = mode; stored.save();
        const digest = instructionDigest(input.instructions);
        if (binding.instructionsDigest !== digest) {
          const boundary = captureHistory(history), applied = record(await native.control('instructions', { text: input.instructions, digest }));
          if (typeof applied.entryId !== 'string') throw new Error('Pi did not return its native instruction entry');
          verifyInstructions(history, digest, input.instructions, boundary, applied.entryId);
          binding.instructionsDigest = digest; stored.save();
        }
        observation.configure(selected.settings);
        usage.initialize(await native.request('get_session_stats'));
        connection = piDelivery(native, { sessionId, history, workspace: input.workspace, receiptFile: receiptFile(context), hooks });
        const owned = native, originalClose = connection.close;
        connection.close = async () => { try { await originalClose(); } finally { run.abort(); await Promise.allSettled(questions); } };
        const ended = () => failed.abort(owned.signal.reason);
        owned.signal.addEventListener('abort', ended, { once: true });
        if (owned.signal.aborted) ended();
        scope.throwIfAborted();
        observation.state('idle'); opened.set(context, connection); return connection;
      } catch (error) { if (connection) await connection.close(); else await native?.close(); throw error; }
    })();
    starting.set(context, pending);
    try { return await pending; } finally { starting.delete(context); admission?.signal.removeEventListener('abort', cancelled); }
  }
  return { open, signal: lifetime,
    async provider(signal: AbortSignal) {
      const connection = opened.values().next().value;
      if (!connection) return failure('unavailable', 'No existing native connection is available for provider inspection');
      return connection.provider(signal);
    },
    async activity(): Promise<NativeActivity> {
      lifetime.throwIfAborted();
      if (starting.size) return { busy: true, contexts: [] };
      const count = opened.size, activity: NativeContextActivity[] = [];
      for (const context of contexts()) {
        const connection = opened.get(context);
        const binding = retained(context);
        if (!binding?.sessionId) {
          if (starting.size) return { busy: true, contexts: [] };
          throw new Error('Pi activity has no exact native history');
        }
        activity.push({ context, sessionId: binding.sessionId,
          busy: connection ? connection.unsettled() || (await connection.inspect()).busy : unacknowledged(context) });
      }
      if (starting.size || opened.size !== count) return { busy: true, contexts: [] };
      for (const item of activity) item.busy ||= opened.get(item.context)?.unsettled() === true;
      return { busy: input.hooks.pendingDecisions?.() === true || activity.some(item => item.busy), contexts: activity };
    },
    async settle(cancelled?: AbortSignal) {
      for (const context of contexts()) if (!opened.has(context) && unacknowledged(context)) await open(context);
      let received = false; for (const connection of opened.values()) received = await connection.settle(cancelled) || received;
      return received;
    },
    acknowledge(ids: readonly string[]) { for (const connection of opened.values()) connection.acknowledge(ids); },
    async activeTurn(room?: string, admission?: InputAdmission) {
      const context = mode === 'shared' ? 'shared' : room === undefined ? 'control' : roomContext(room), connection = admission ? await open(context, admission) : opened.get(context);
      const turn = connection ? await connection.turnControl.activeTurn(undefined, admission) : null;
      return turn ? JSON.stringify([context, turn]) : null;
    },
    async interrupt(turn: string, recovery?: boolean, admission?: InputAdmission) {
      const value: unknown = JSON.parse(turn);
      if (!Array.isArray(value) || value.length !== 2 || value.some(part => typeof part !== 'string') || !retained(value[0] as string)) throw new Error('Invalid captured Pi history and execution');
      return (await open(value[0] as string, admission)).turnControl.interrupt(value[1] as string, recovery, admission);
    },
    async close() {
      failed.abort(new Error('Pi history owner stopped'));
      await Promise.allSettled(starting.values());
      const results = await Promise.allSettled([...opened.values()].map(connection => connection.close()));
      const errors = results.filter(value => value.status === 'rejected').map(value => value.reason as unknown);
      if (errors.length) throw new AggregateError(errors, 'Pi history cleanup did not complete');
    },
  };
}
