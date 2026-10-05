import { lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';
import * as check from '@crossfire/contracts/schema/validation';
import { success, failure } from '@crossfire/kernel/result';
import { fields } from '@crossfire/contracts/validation';
import { acquireFileLock } from '@crossfire/adapter-filesystem/lock';
import { MAX_INPUT_BYTES } from '@crossfire/contracts/runtime';

export const deliveryText: check.Parser<string> = value => typeof value === 'string' && Buffer.byteLength(value) <= MAX_INPUT_BYTES
  ? success(value) : failure('invalid', 'Native delivery text exceeds its byte bound');

export function deliveryJournalExists(file: string): boolean {
  try { lstatSync(file); return true; }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false; throw error; }
}

export function readDeliveryJournal<Pending extends { text: string; messageId: string }>(file: string, sessionId: string, pending: check.Parser<Pending>) {
  const parsed = fields(deliveryJournalExists(file) ? readJson<unknown>(file, 32 * 1024 * 1024) : { sessionId, pending: null, confirmed: [] }, ['sessionId', 'pending', 'confirmed']);
  if (!parsed.ok || !check.text(200)(parsed.value.sessionId).ok || parsed.value.sessionId !== sessionId) throw new Error('Invalid native delivery journal or session binding');
  const delivery = check.nullable(pending)(parsed.value.pending);
  const confirmed = check.list(check.object({ messageId: check.text(200),
    digest: check.refine(check.text(64), value => /^[a-f0-9]{64}$/u.test(value), 'Invalid native receipt digest') }), 128)(parsed.value.confirmed);
  if (!delivery.ok || !confirmed.ok) throw new Error('Invalid native delivery journal');
  if (new Set(confirmed.value.map(item => item.messageId)).size !== confirmed.value.length) throw new Error('Duplicate native receipt identities');
  if (delivery.value && confirmed.value.some(item => item.messageId === delivery.value!.messageId)) throw new Error('Native input cannot be both pending and confirmed');
  return { sessionId, pending: delivery.value, confirmed: confirmed.value };
}

export function deliveryJournal<Pending extends { text: string; messageId: string }>(file: string, sessionId: string, pending: check.Parser<Pending>) {
  const release = acquireFileLock(file);
  try {
    const state = readDeliveryJournal(file, sessionId, pending);
    let closed = false;
    const owned = () => { if (closed) throw new Error('Native delivery journal is closed'); };
    const save = () => { owned(); writeJson(file, state, 32 * 1024 * 1024); };
    const digest = (text: string) => createHash('sha256').update(text).digest('hex');
    return {
      close: () => { closed = true; release(); },
      pending: () => { owned(); return state.pending; },
      unsettled: () => { owned(); return state.pending !== null || state.confirmed.length > 0; },
      confirmed(text: string, messageId: string): boolean {
        owned();
        const existing = state.confirmed.find(item => item.messageId === messageId);
        if (existing && existing.digest !== digest(text)) throw new Error('Native delivery identity was reused with different content');
        return existing !== undefined;
      },
      prepare(value: Pending): void {
        owned();
        const valid = pending(value);
        if (!valid.ok) throw new Error(valid.error.message);
        if (state.confirmed.length >= 128) throw new Error('Acknowledge confirmed native deliveries before submitting more input');
        state.pending = valid.value; save();
      },
      complete(value: Pending, received: boolean): void {
        owned();
        if (received && !state.confirmed.some(item => item.messageId === value.messageId)) {
          state.confirmed.push({ messageId: value.messageId, digest: digest(value.text) });
        }
        state.pending = null; save();
      },
      acknowledge(messageIds: readonly string[]): void {
        owned();
        const acknowledged = new Set(messageIds);
        state.confirmed = state.confirmed.filter(item => !acknowledged.has(item.messageId)); save();
      },
    };
  } catch (error) { release(); throw error; }
}
