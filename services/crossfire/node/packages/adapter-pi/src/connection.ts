import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { RuntimeHooks, TurnControl } from '@ctlflow/crossfire-agent-core/runtime';
import { nativeDelivery } from '@ctlflow/crossfire-adapter-runtime/delivery';
import { captureHistory } from '@ctlflow/crossfire-adapter-runtime/native-file';
import { resumptionText, retainResumptionInput } from '@ctlflow/crossfire-adapter-runtime/resumption';
import { piInput, type PiInput } from './input.js';
import { record, type PiProcess } from './protocol.js';
import { verifyPiHistory } from './state.js';
import { piReceipt } from './receipt.js';
import { providerState } from './provider.js';

export function piDelivery(native: PiProcess, options: { sessionId: string; workspace: string; history: string; receiptFile: string; hooks: RuntimeHooks }) {
  const { sessionId } = options;
  let interrupted = false, replayed = false, pending: PiInput | undefined;
  let revision = 0, wake: (() => void) | undefined;
  const changed = () => { revision++; wake?.(); };
  async function state(scope = native.signal) {
    const value = record(await native.control('state', {}, scope));
    if (value.sessionId !== sessionId || typeof value.idle !== 'boolean' || value.leafId !== null && typeof value.leafId !== 'string'
      || value.turn !== null && typeof value.turn !== 'string' || value.pending !== null && typeof value.pending !== 'string') throw new Error('Pi control does not match the exact native history');
    return { idle: value.idle, leaf: value.leafId as string | null, turn: value.turn as string | null, pending: value.pending as string | null };
  }
  async function publish(input: PiInput, retain: (input: PiInput) => void): Promise<void> {
    pending = input;
    const selected = input.resumption ?? input;
    const response = record(await native.control('deliver', { text: selected.text, messageId: selected.messageId }));
    if (typeof response.armed !== 'boolean') throw new Error('Invalid Pi publication result');
    if (response.armed) {
      const updated = { ...selected, published: true };
      pending = input.resumption ? { ...input, resumption: updated } : updated; retain(pending);
    }
  }
  const delivery = nativeDelivery<PiInput>({ sessionId, approval: 'none', signal: native.signal,
    verify: async scope => { scope.throwIfAborted(); verifyPiHistory(options.history, options.workspace, sessionId); await state(scope); },
    inspect: async () => { const value = await state(); return { busy: !value.idle || value.pending !== null }; },
    prepare: (text, messageId) => {
      const boundary = captureHistory(options.history);
      if (!boundary) throw new Error('Pi history disappeared before native publication');
      interrupted = false; return { text, messageId, boundary, published: false };
    }, publish,
    received: async (input, retain, scope, restored) => {
      const current = await state(scope), selected = input.resumption ?? input;
      if (input.resumption) retainResumptionInput(input, options.receiptFile);
      if (piReceipt(options.history, selected.boundary, selected, current.leaf)) {
        pending = undefined;
        if (input.resumption) options.hooks.observe?.({ kind: 'output', sessionId, id: selected.messageId + '-verified', streamId: null,
          text: 'Native execution resumed with the exact last message retained as context. Earlier receipt could not be established; completed actions must not be repeated.' });
        return true;
      }
      if (restored && !replayed && current.idle && current.pending === null) {
        const boundary = captureHistory(options.history);
        if (!boundary) throw new Error('Pi history disappeared during restart recovery');
        const resumed = { ...input, resumption: { text: resumptionText(input, options.receiptFile, options.workspace),
          messageId: randomUUID(), boundary, published: false } };
        replayed = true; retain(resumed); await publish(resumed, retain); return 'waiting';
      }
      if (interrupted && !selected.published) { pending = undefined; return 'interrupted'; }
      if (!selected.published && !restored && current.idle && current.pending === null) await publish(input, retain);
      return !current.idle ? 'waiting' : false;
    }, cancel: () => false,
    wait: async (milliseconds, signal) => {
      const previous = revision, timeout = new AbortController(), scope = AbortSignal.any([signal, timeout.signal]);
      try {
        await Promise.race([delay(milliseconds, undefined, { signal: scope }), new Promise<void>(resolve => { wake = resolve; if (revision !== previous) resolve(); })]);
      } finally { wake = undefined; timeout.abort(); }
    }, close: native.close }, piInput, { journal: options.receiptFile, pollMs: 1000 });
  const turnControl: TurnControl = {
    activeTurn: async (_room, admission) => (await state(admission?.signal)).turn,
    interrupt: async (turn, _recovery, admission) => {
      const response = record(await native.control('interrupt', { turn }, admission?.signal));
      if (typeof response.interrupted !== 'boolean') throw new Error('Invalid Pi captured interruption outcome');
      if (response.interrupted && pending && !(pending.resumption ?? pending).published) interrupted = true;
      changed(); return response.interrupted ? 'interrupted' : 'inactive';
    },
  };
  return { ...delivery, turnControl, changed, provider: (signal: AbortSignal) => providerState(native, signal) };
}
export type PiConnection = ReturnType<typeof piDelivery>;
