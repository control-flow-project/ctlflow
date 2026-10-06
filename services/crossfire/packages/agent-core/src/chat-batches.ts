import { createHash } from 'node:crypto';
import { MAX_INPUT_BYTES } from '@ctlflow/crossfire-contracts/runtime';
import type { Settings } from '@ctlflow/crossfire-contracts/client';
import type { PrincipalIdentity } from '@ctlflow/crossfire-contracts/schema/response';
import { deliveryText, deliveryEnvelope, type ReceivedEvent } from './receive.js';
import type { MessageArtifacts } from './message-artifacts.js';

export function chatBatches(events: readonly ReceivedEvent[], settings: Settings,
  identities: ReadonlyMap<string, PrincipalIdentity>, maximum: number, mode: 'shared' | 'per-room', artifacts: MessageArtifacts) {
  if (!Number.isSafeInteger(maximum) || maximum < 1024 || maximum > MAX_INPUT_BYTES) throw new Error('Invalid runtime input budget');
  const batches: { events: ReceivedEvent[]; text: string; messageId: string; messages: number; room: string | null }[] = [];
  const groups = mode === 'per-room' ? [...new Set(events.map(event => event.room_id))].map(room => events.filter(event => event.room_id === room)) : [events];
  for (const group of groups) {
    let current: ReceivedEvent[] = [];
    function flush(): void {
      if (!current.length) return;
      const messageId = 'crossfire-' + createHash('sha256').update(JSON.stringify([settings.instance, ...current.map(event => [event.room_id, event.event_id])])).digest('hex');
      const original = deliveryText(current, settings, identities);
      const envelope = deliveryEnvelope(current, settings, identities);
      const { events: _events, ...metadata } = envelope;
      const text = artifacts.prepare(current, original, messageId, maximum, metadata);
      if (Buffer.byteLength(text) > maximum) throw new Error('Large chat delivery requires a private message artifact store');
      batches.push({ events: current, text, messageId,
        messages: current.filter(event => event.type === 'm.room.message').length, room: mode === 'per-room' ? current[0]!.room_id : null });
      current = [];
    }
    for (const event of group) {
      current.push(event);
    }
    flush();
  }
  return batches;
}
