import { createHash } from 'node:crypto';
import { INPUT_BYTES, MAX_INPUT_BYTES } from '@crossfire/contracts/runtime';
import type { Settings } from '@crossfire/contracts/client';
import type { PrincipalIdentity } from '@crossfire/contracts/schema/response';
import { deliveryText, type ReceivedEvent } from './receive.js';

export function chatBatches(events: readonly ReceivedEvent[], settings: Settings,
  identities: ReadonlyMap<string, PrincipalIdentity>, maximum = INPUT_BYTES, mode: 'shared' | 'per-room' = 'shared') {
  if (!Number.isSafeInteger(maximum) || maximum < 1024 || maximum > MAX_INPUT_BYTES) throw new Error('Invalid runtime input budget');
  const batches: { events: ReceivedEvent[]; text: string; messageId: string; messages: number; room: string | null }[] = [];
  const groups = mode === 'per-room' ? [...new Set(events.map(event => event.room_id))].map(room => events.filter(event => event.room_id === room)) : [events];
  for (const group of groups) {
    let current: ReceivedEvent[] = [];
    function flush(): void {
      if (!current.length) return;
      batches.push({ events: current, text: deliveryText(current, settings, identities), messageId: 'crossfire-' + createHash('sha256')
        .update(JSON.stringify([settings.instance, ...current.map(event => [event.room_id, event.event_id])])).digest('hex'),
        messages: current.filter(event => event.type === 'm.room.message').length, room: mode === 'per-room' ? current[0]!.room_id : null });
      current = [];
    }
    for (const event of group) {
      if (Buffer.byteLength(deliveryText([event], settings, identities)) > maximum) throw new Error(`A chat event exceeds the ${maximum}-byte runtime input limit; retrieve it explicitly`);
      if (Buffer.byteLength(deliveryText([...current, event], settings, identities)) > maximum) flush();
      current.push(event);
    }
    flush();
  }
  return batches;
}
