import { createHash } from 'node:crypto';
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import { ownerNotice, ownerNoticeChunks, ownerNoticeFits } from './owner-notices.js';
import type { RuntimeObservationEvent } from './runtime.js';
import type { NativeSessionState } from './runtime.js';
import { observation, type RuntimeObservation } from '@ctlflow/crossfire-contracts/runtime';
import type { Clock, LocalState, Transport } from './port.js';
import type { Coordination } from './coordination.js';

type Output = { id: string; text: string; sources: string[]; streamId: string | null; sealed: boolean };
type Journal = { output: Output[]; observations: RuntimeObservation[] };
export function ownerObservation(options: { agentId: string; userId: string; file: string; storage: LocalState; clock: Clock;
  transport: Transport; coordination: Coordination; historyMode: 'shared' | 'per-room'; maximum: number;
  native?: () => NativeSessionState | undefined }, stop: AbortSignal) {
  const journalBytes = 64 * 1024 * 1024;
  const journal = options.storage.exists(options.file) ? options.storage.read<Journal>(options.file, journalBytes) : { output: [], observations: [] };
  if (!journal || !Array.isArray(journal.output) || journal.output.some(item => typeof item.id !== 'string' || typeof item.text !== 'string'
    || !ownerNoticeFits(item.text) || typeof item.sealed !== 'boolean' || item.streamId !== null && typeof item.streamId !== 'string'
    || !Array.isArray(item.sources) || !item.sources.length || item.sources.some(source => typeof source !== 'string'))
    || !Array.isArray(journal.observations) || journal.observations.some(item => !observation(item).ok)) throw new Error('Invalid owner observation journal');
  let runId: string | undefined;
  const active = new Map<string, boolean>();
  const latest = new Map(journal.observations.map(value => [value.sessionId, value]));
  let lastActivityAt = Math.max(0, ...journal.observations.map(value => value.lastActivityAt ?? 0)) || null;
  let deliveredSession: string | undefined;
  let typingRoom: string | undefined;
  let cancelTyping: (() => void) | undefined;
  let running: Promise<void> | undefined;
  let publishing: RuntimeObservation | undefined;
  const pendingSources = new Set(journal.output.flatMap(item => item.sources));
  function save(): void { options.storage.write(options.file, journal, journalBytes); }
  async function typing(room: string, enabled: boolean): Promise<void> {
    await options.transport(AbortSignal.timeout(10000), 10000).put(API + '/rooms/' + segment(room) + '/typing/' + segment(options.userId), { typing: enabled, ...(enabled ? { timeout: 30000 } : {}) });
  }
  async function clearTyping(): Promise<void> {
    cancelTyping?.(); cancelTyping = undefined;
    const room = typingRoom; typingRoom = undefined;
    if (room) await typing(room, false).catch(() => undefined);
  }
  async function delivered(room: string, sessionId: string): Promise<void> {
    await clearTyping();
    deliveredSession = sessionId;
    if (!active.get(sessionId) || stop.aborted) return;
    typingRoom = room;
    await typing(room, true).catch(() => undefined);
    cancelTyping = options.clock.schedule(() => { typingRoom = undefined; cancelTyping = undefined; }, 30000);
  }
  function observe(event: RuntimeObservationEvent): void {
    if (event.kind === 'state') {
      const busy = ['working', 'waiting-answer', 'waiting-approval'].includes(event.observation.state);
      active.set(event.observation.sessionId, busy);
      if (!busy && deliveredSession === event.observation.sessionId) void clearTyping();
      const previous = journal.observations.at(-1);
      if (previous !== publishing && previous?.sessionId === event.observation.sessionId && previous.state === event.observation.state && previous.state !== 'failed') journal.observations.pop();
      if (busy) lastActivityAt = options.clock.now();
      const native = options.native?.();
      const value = { ...event.observation, historyMode: options.historyMode, maxInputBytes: options.maximum,
        lastActivityAt: native?.lastActivityAt ?? lastActivityAt, historyAvailable: native?.historyAvailable ?? null };
      latest.set(value.sessionId, value);
      journal.observations.push(value);
    } else {
      lastActivityAt = options.clock.now();
      let position = 0;
      const streamId = event.streamId === null ? null : JSON.stringify([event.sessionId, event.streamId]);
      for (const part of ownerNoticeChunks(event.text)) {
        const id = createHash('sha256').update(JSON.stringify([event.sessionId, event.id, position++])).digest('hex');
        if (pendingSources.has(id)) continue;
        const previous = journal.output.at(-1);
        if (streamId !== null && previous?.streamId === streamId && !previous.sealed && ownerNoticeFits(previous.text + part)) {
          previous.text += part; previous.sources.push(id);
        } else journal.output.push({ id, text: part, sources: [id], streamId, sealed: false });
        pendingSources.add(id);
      }
    }
    save();
  }
  async function flush(scope = AbortSignal.any([stop, AbortSignal.timeout(15000)])): Promise<void> {
    if (!runId) return;
    while (journal.observations.length) {
      const pending = journal.observations[0]!;
      publishing = pending;
      const result = await options.coordination.runtime(options.agentId, runId, pending, scope).finally(() => { publishing = undefined; });
      if (!result.ok && result.error.code !== 'conflict') return;
      journal.observations.shift(); save();
    }
    while (journal.output.length) {
      const output = journal.output[0]!;
      if (!output.sealed) { output.sealed = true; save(); }
      const conversation = await options.coordination.ownerConversation(options.agentId, scope);
      if (!conversation.ok) return;
      const client = options.transport(scope, 15000);
      await client.put(API + '/rooms/' + segment(conversation.value.roomId) + '/send/m.room.message/observation-' + output.id,
        ownerNotice(output.text));
      journal.output.shift();
      for (const source of output.sources) pendingSources.delete(source);
      save();
    }
  }
  const stopped = () => { void clearTyping(); };
  stop.addEventListener('abort', stopped, { once: true });
  return { observe, delivered, busy: () => [...active.values()].some(value => value),
    start(id: string): void {
      if (runId !== id) {
        for (const value of latest.values()) if (!journal.observations.some(pending => pending.sessionId === value.sessionId && pending.observedAt === value.observedAt)) journal.observations.push(value);
        save();
      }
      runId = id;
      running ??= (async () => { while (!stop.aborted) {
        try { await flush(); } catch { if (stop.aborted) break; }
        await options.clock.delay(1000, stop);
      } })().catch(() => undefined);
    },
    async close(): Promise<void> { stop.removeEventListener('abort', stopped); await clearTyping(); await running; await flush(options.clock.deadline(15000)).catch(() => undefined); },
  };
}
