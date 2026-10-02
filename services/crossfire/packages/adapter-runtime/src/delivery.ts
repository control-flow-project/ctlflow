import { setTimeout as delay } from 'node:timers/promises';
import type { RuntimeConnection } from '@crossfire/agent-core/runtime';
import * as check from '@crossfire/contracts/schema/validation';
import { deliveryJournal, deliveryText } from './journal.js';
import { fields } from '@crossfire/contracts/validation';
import { success } from '@crossfire/kernel/result';

export type NativeInput<Boundary> = { text: string; messageId: string; boundary: Boundary };
export type NativeReceipt = boolean | 'cancelled' | 'waiting';
export type Publication<Boundary> = {
  sessionId: string;
  signal: AbortSignal;
  verify: () => void | Promise<void>;
  inspect: () => Promise<{ busy: boolean }>;
  boundary: () => Boundary | Promise<Boundary>;
  publish: (input: NativeInput<Boundary>) => void | Promise<void>;
  received: (input: NativeInput<Boundary>) => NativeReceipt | Promise<NativeReceipt>;
  cancel?: (input: NativeInput<Boundary>) => boolean | Promise<boolean>;
  close: () => void | Promise<void>;
};

export function nativeDelivery<Boundary>(native: Publication<Boundary>, parseBoundary: check.Parser<Boundary>,
  options: { journal: string; pollMs: number; timeoutMs?: number }): Omit<RuntimeConnection, 'turnControl'> {
  if (!Number.isInteger(options.pollMs) || options.pollMs < 100 || options.pollMs > 30_000) throw new Error('Native receipt poll interval must be 100..30000 ms');
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) throw new Error('Invalid native receipt deadline');
  const schema: check.Parser<NativeInput<Boundary>> = input => {
    const parsed = fields(input, ['text', 'messageId', 'boundary']);
    if (!parsed.ok) return parsed;
    const text = deliveryText(parsed.value.text), messageId = check.text(200)(parsed.value.messageId), boundary = parseBoundary(parsed.value.boundary);
    if (!text.ok) return text;
    if (!messageId.ok) return messageId;
    if (!boundary.ok) return boundary;
    return success({ text: text.value, messageId: messageId.value, boundary: boundary.value });
  };
  const journal = deliveryJournal(options.journal, native.sessionId, schema);
  let delivering = false;
  async function settle(scope = native.signal): Promise<boolean> {
    const pending = journal.pending();
    if (!pending) return false;
    let deadline = performance.now() + timeoutMs;
    for (;;) {
      scope.throwIfAborted();
      await native.verify();
      const receipt = await native.received(pending);
      if (receipt === true || receipt === 'cancelled') { journal.complete(pending, receipt === true); return receipt === true; }
      if (receipt === 'waiting') deadline = performance.now() + timeoutMs;
      if (performance.now() >= deadline) throw new Error('Native publication remains uncertain; its journal prevents resubmission and read positions are unchanged');
      await delay(Math.min(options.pollMs, deadline - performance.now()), undefined, { signal: scope });
    }
  }
  return {
    sessionId: native.sessionId, signal: native.signal,
    inspect: async () => { native.signal.throwIfAborted(); return native.inspect(); },
    close: async () => { try { await native.close(); } finally { journal.close(); } }, acknowledge: journal.acknowledge,
    settle: () => settle(),
    async recover(text, messageId) {
      if (delivering) throw new Error('Native receipt recovery must be sequential');
      const pending = journal.pending();
      if (pending) {
        if (pending.messageId !== messageId || pending.text !== text) throw new Error('Receipt recovery does not match the pending native input');
        return settle();
      }
      return journal.confirmed(text, messageId);
    },
    async deliver(text, messageId, cancelled) {
      if (delivering) throw new Error('Native delivery must be sequential');
      delivering = true;
      try {
        const scope = cancelled ? AbortSignal.any([native.signal, cancelled]) : native.signal;
        scope.throwIfAborted();
        const pending = journal.pending();
        if (pending) {
          if (pending.messageId !== messageId || pending.text !== text) throw new Error('Settle the preceding native delivery before submitting different input');
          if (!await settle(scope)) throw new Error('Native input was cancelled before publication; read positions are unchanged');
          return;
        }
        if (journal.confirmed(text, messageId)) return;
        await native.verify();
        const input = { text, messageId, boundary: await native.boundary() };
        scope.throwIfAborted();
        journal.prepare(input);
        try {
          await native.publish(input);
          if (!await settle(scope)) throw new Error('Native input was cancelled before publication; read positions are unchanged');
        }
        catch (error) {
          if (scope.aborted && !native.signal.aborted && native.cancel && await native.cancel(input)) journal.complete(input, false);
          throw error;
        }
      } finally { delivering = false; }
    },
  };
}
