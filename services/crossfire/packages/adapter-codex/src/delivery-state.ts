import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';
import * as check from '@crossfire/contracts/schema/validation';
import { success, failure } from '@crossfire/kernel/result';

export type HistoryBoundary = { position: number; key: string };
export type Delivery = { turn: string | null; text: string; messageId: string; boundary: HistoryBoundary | null; initializing: boolean };
const receipt = check.object({ messageId: check.text(200), digest: check.text(64) });
const text: check.Parser<string> = value => typeof value === 'string' && Buffer.byteLength(value) <= 98304
  ? success(value) : failure('invalid', 'Native delivery text exceeds its byte bound');
const delivery = check.object({ turn: check.nullable(check.text(200)), text, messageId: check.text(200),
  boundary: check.nullable(check.object({ position: check.integer(0, Number.MAX_SAFE_INTEGER), key: check.text(1000) })), initializing: check.boolean });
const schema = check.object({ sessionId: check.identifier, pending: check.nullable(delivery), confirmed: check.list(receipt, 128) });

export function deliveryState(file: string, sessionId: string) {
  const result = schema(existsSync(file) ? readJson<unknown>(file) : { sessionId, pending: null, confirmed: [] });
  if (!result.ok || result.value.sessionId !== sessionId) throw new Error('Invalid native delivery journal or session binding');
  const state = result.value;
  const save = () => writeJson(file, state);
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  return {
    pending: () => state.pending,
    confirmed(text: string, messageId: string): boolean {
      const existing = state.confirmed.find(item => item.messageId === messageId);
      if (existing && existing.digest !== digest(text)) throw new Error('Native delivery identity was reused with different content');
      return existing !== undefined;
    },
    prepare(value: Delivery): void {
      if (state.confirmed.length >= 128) throw new Error('Acknowledge confirmed native deliveries before submitting more input');
      state.pending = value; save();
    },
    complete(value: Delivery, received: boolean): void {
      if (received && !state.confirmed.some(item => item.messageId === value.messageId)) {
        state.confirmed.push({ messageId: value.messageId, digest: digest(value.text) });
      }
      state.pending = null; save();
    },
    acknowledge(messageIds: readonly string[]): void {
      const acknowledged = new Set(messageIds);
      state.confirmed = state.confirmed.filter(item => !acknowledged.has(item.messageId)); save();
    },
  };
}
