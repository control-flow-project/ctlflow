import { setTimeout as delay } from 'node:timers/promises';
import type { RuntimeApproval, RuntimeConnection } from '@ctlflow/crossfire-agent-core/runtime';
import type { Parser } from '@ctlflow/crossfire-contracts/schema/validation';
import { deliveryJournal } from './journal.js';

export type NativeMessage = { text: string; messageId: string };
export type NativeInput<Boundary> = NativeMessage & { boundary: Boundary };
export type NativeReceipt = boolean | 'cancelled' | 'interrupted' | 'waiting';
export type Publication<Input extends NativeMessage> = {
  sessionId: string;
  approval: RuntimeApproval;
  signal: AbortSignal;
  verify: () => void | Promise<void>;
  inspect: () => Promise<{ busy: boolean }>;
  prepare: (text: string, messageId: string) => Input | Promise<Input>;
  publish: (input: Input, retain: (input: Input) => void) => void | Promise<void>;
  received: (input: Input, retain: (input: Input) => void) => NativeReceipt | Promise<NativeReceipt>;
  cancel?: (input: Input) => boolean | Promise<boolean>;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  close: () => void | Promise<void>;
};

export function nativeDelivery<Input extends NativeMessage>(native: Publication<Input>, parse: Parser<Input>,
  options: { journal: string; pollMs: number; timeoutMs?: number; now?: () => number }): Omit<RuntimeConnection, 'turnControl'> & { unsettled: () => boolean } {
  if (!Number.isInteger(options.pollMs) || options.pollMs < 100 || options.pollMs > 30_000) throw new Error('Native receipt poll interval must be 100..30000 ms');
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) throw new Error('Invalid native receipt deadline');
  const journal = deliveryJournal(options.journal, native.sessionId, parse);
  const now = options.now ?? (() => performance.now());
  let operating = false;
  function retain(input: Input): void {
    const pending = journal.pending();
    if (!pending || input.text !== pending.text || input.messageId !== pending.messageId) throw new Error('Native evidence cannot replace its original input identity or content');
    journal.prepare(input);
  }
  async function settle(scope = native.signal): Promise<true | 'cancelled' | 'interrupted' | null> {
    if (!journal.pending()) return null;
    let deadline = now() + timeoutMs;
    for (;;) {
      scope.throwIfAborted();
      await native.verify();
      const input = journal.pending();
      if (!input) throw new Error('Native publication evidence disappeared before settlement');
      const receipt = await native.received(input, retain);
      if (receipt === true || receipt === 'cancelled' || receipt === 'interrupted') {
        journal.complete(input, receipt === true); return receipt;
      }
      if (receipt === 'waiting') deadline = now() + timeoutMs;
      if (now() >= deadline) throw new Error('Native publication remains uncertain; its journal prevents resubmission and read positions are unchanged');
      const milliseconds = Math.min(options.pollMs, Math.max(1, deadline - now()));
      if (native.wait) await native.wait(milliseconds, scope);
      else await delay(milliseconds, undefined, { signal: scope });
    }
  }
  async function exclusive<Value>(action: () => Promise<Value>): Promise<Value> {
    if (operating) throw new Error('Native publication and receipt recovery must be sequential');
    operating = true;
    try { return await action(); } finally { operating = false; }
  }
  return {
    sessionId: native.sessionId, approval: native.approval, signal: native.signal,
    inspect: async () => { native.signal.throwIfAborted(); return native.inspect(); },
    close: async () => { try { await native.close(); } finally { journal.close(); } },
    acknowledge: journal.acknowledge, unsettled: () => operating || journal.unsettled(),
    settle: () => exclusive(async () => await settle() === true),
    recover: (text, messageId) => exclusive(async () => {
      const pending = journal.pending();
      if (pending) {
        if (pending.messageId !== messageId || pending.text !== text) throw new Error('Receipt recovery does not match the pending native input');
        return await settle() === true;
      }
      return journal.confirmed(text, messageId);
    }),
    deliver: (text, messageId, cancelled) => exclusive(async () => {
      const scope = cancelled ? AbortSignal.any([native.signal, cancelled]) : native.signal;
      scope.throwIfAborted();
      const pending = journal.pending();
      if (pending && (pending.messageId !== messageId || pending.text !== text)) throw new Error('Settle the preceding native delivery before submitting different input');
      for (;;) {
        scope.throwIfAborted();
        if (journal.confirmed(text, messageId)) return;
        let input = journal.pending();
        if (!input) {
          await native.verify();
          input = await native.prepare(text, messageId);
          if (input.messageId !== messageId || input.text !== text) throw new Error('Native input preparation changed its identity or content');
          scope.throwIfAborted();
          journal.prepare(input);
          try { await native.publish(input, retain); }
          catch (error) {
            const retained = journal.pending();
            if (scope.aborted && !native.signal.aborted && native.cancel && retained && await native.cancel(retained)) journal.complete(retained, false);
            throw error;
          }
        }
        try {
          const receipt = await settle(scope);
          if (receipt === true) return;
          if (receipt !== 'interrupted') throw new Error('Native input was cancelled before publication; read positions are unchanged');
        } catch (error) {
          const retained = journal.pending();
          if (scope.aborted && !native.signal.aborted && native.cancel && retained && await native.cancel(retained)) journal.complete(retained, false);
          throw error;
        }
      }
    }),
  };
}
