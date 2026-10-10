import { createHash, randomUUID, type Hash } from 'node:crypto';
import type { RuntimeHooks } from '@ctlflow/crossfire-agent-core/runtime';
import type { RuntimeObservation } from '@ctlflow/crossfire-contracts/runtime';
import { record } from './protocol.js';
import { piErrorText } from './errors.js';

export function piObservation(hooks: RuntimeHooks, session: () => string) {
  let settings: RuntimeObservation['settings'] = [];
  let stream: { id: string; bytes: number; hash: Hash } | null = null;
  function state(value: RuntimeObservation['state'], errorMessage: string | null = null): void {
    hooks.observe?.({ kind: 'state', observation: { runtime: 'pi', sessionId: session(), roomId: null, state: value, observedAt: Date.now(), settings,
      errorMessage: errorMessage === null ? null : piErrorText(errorMessage) } });
  }
  function output(id: string, text: string, streamId: string | null = null): void {
    if (text) hooks.observe?.({ kind: 'output', sessionId: session(), id, streamId, text });
  }
  return { state, configure: (value: RuntimeObservation['settings']) => { settings = value; }, event(event: Record<string, unknown>): void {
    if (event.type === 'agent_start' || event.type === 'auto_retry_start' || event.type === 'auto_compaction_start') state('working');
    else if (event.type === 'agent_settled') state('idle');
    else if (event.type === 'message_start') {
      const message = record(event.message);
      if (message.role === 'assistant') stream = { id: randomUUID(), bytes: 0, hash: createHash('sha256') };
    } else if (event.type === 'message_update') {
      const change = record(event.assistantMessageEvent);
      if (change.type !== 'text_delta') return;
      if (!stream || typeof change.delta !== 'string') throw new Error('Pi text delta has no exact native message stream');
      output(stream.id + ':' + stream.bytes, change.delta, stream.id); stream.bytes += Buffer.byteLength(change.delta); stream.hash.update(change.delta);
    } else if (event.type === 'message_end') {
      const message = record(event.message);
      if (message.role !== 'assistant' && message.role !== 'toolResult') return;
      if (!Array.isArray(message.content)) throw new Error('Invalid native Pi message content');
      const text = message.content.map(record).filter(part => part.type === 'text').map(part => {
        if (typeof part.text !== 'string') throw new Error('Invalid Pi output text'); return part.text;
      }).join('');
      if (message.role === 'assistant' && stream) {
        if (!stream.bytes) output(stream.id + ':0', text, null);
        else if (stream.bytes !== Buffer.byteLength(text) || stream.hash.digest('hex') !== createHash('sha256').update(text).digest('hex')) throw new Error('Completed Pi text differs from its native stream');
        stream = null;
      } else output(randomUUID(), text);
    } else if (event.type === 'extension_ui_request' && event.method === 'notify' && typeof event.message === 'string') output(String(event.id), event.message);
  } };
}
