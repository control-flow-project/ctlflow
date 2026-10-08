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
  let typingGeneration = 0;
  let typingWork = Promise.resolve();
  let cancelTyping: (() => void) | undefined;
  let running: Promise<void> | undefined;
  let wakeFlusher: (() => void) | undefined;
  let publishing: RuntimeObservation | undefined;
  const pendingSources = new Set(journal.output.flatMap(item => item.sources));
  function save(): void { options.storage.write(options.file, journal, journalBytes); }
  function notice(identity: string, text: string): void {
    let position = 0;
    for (const part of ownerNoticeChunks(text)) {
      const id = createHash('sha256').update(JSON.stringify(['listener-notice', identity, position++])).digest('hex');
      if (pendingSources.has(id)) continue;
      journal.output.push({ id, text: part, sources: [id], streamId: null, sealed: true });
      pendingSources.add(id);
    }
    save();
    wakeFlusher?.();
  }
  async function typing(room: string, enabled: boolean): Promise<void> {
    await options.transport(AbortSignal.timeout(10000), 10000).put(API + '/rooms/' + segment(room) + '/typing/' + segment(options.userId), { typing: enabled, ...(enabled ? { timeout: 30000 } : {}) });
  }
  async function clearTyping(): Promise<void> {
    typingGeneration++;
    cancelTyping?.(); cancelTyping = undefined;
    const room = typingRoom; typingRoom = undefined;
    typingWork = typingWork.then(async () => { if (room) await typing(room, false).catch(() => undefined); });
    await typingWork;
  }
  async function delivered(room: string, sessionId: string): Promise<void> {
    const generation = ++typingGeneration;
    cancelTyping?.(); cancelTyping = undefined;
    const previous = typingRoom;
    deliveredSession = sessionId;
    typingRoom = !stop.aborted && active.get(sessionId) ? room : undefined;
    typingWork = typingWork.then(async () => {
      if (previous) await typing(previous, false).catch(() => undefined);
      if (generation !== typingGeneration || stop.aborted || !active.get(sessionId)) return;
      await typing(room, true).catch(() => undefined);
      if (generation !== typingGeneration) return;
      cancelTyping = options.clock.schedule(() => { typingRoom = undefined; cancelTyping = undefined; }, 30000);
    });
    await typingWork;
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
  async function flushObservations(scope = AbortSignal.any([stop, AbortSignal.timeout(15000)])): Promise<void> {
    if (!runId) return;
    while (journal.observations.length) {
      const pending = journal.observations[0]!;
      publishing = pending;
      try {
        const result = await options.coordination.runtime(options.agentId, runId, pending, scope);
        if (!result.ok && result.error.code !== 'conflict') return;
        journal.observations.shift(); save();
      } finally { publishing = undefined; }
    }
  }
  async function flushOutput(scope = AbortSignal.any([stop, AbortSignal.timeout(15000)])): Promise<boolean> {
    if (!runId) return false;
    while (journal.output.length) {
      const output = journal.output[0]!;
      if (!output.sealed) { output.sealed = true; save(); }
      const conversation = await options.coordination.ownerConversation(options.agentId, scope);
      if (!conversation.ok) return false;
      const client = options.transport(scope, 15000);
      await client.put(API + '/rooms/' + segment(conversation.value.roomId) + '/send/m.room.message/observation-' + output.id,
        ownerNotice(output.text));
      journal.output.shift();
      for (const source of output.sources) pendingSources.delete(source);
      save();
    }
    return true;
  }
  const stopped = () => { void clearTyping(); };
  stop.addEventListener('abort', stopped, { once: true });
  return { observe, delivered, notice, busy: () => [...active.values()].some(value => value),
    start(id: string): void {
      if (runId !== id) {
        for (const value of latest.values()) if (!journal.observations.some(pending => pending !== publishing
          && pending.sessionId === value.sessionId && pending.observedAt === value.observedAt)) journal.observations.push({ ...value });
        save();
      }
      runId = id;
      const outputs = async () => { while (!stop.aborted) {
        let flushed = false;
        try { flushed = await flushOutput(); } catch { if (stop.aborted) break; }
        if (flushed && journal.output.length) continue;
        await new Promise<void>(resolve => {
          const finish = () => { cancel(); stop.removeEventListener('abort', finish); wakeFlusher = undefined; resolve(); };
          const cancel = options.clock.schedule(finish, 1000);
          wakeFlusher = finish;
          stop.addEventListener('abort', finish, { once: true });
          if (stop.aborted) finish();
        });
      } };
      const observations = async () => { while (!stop.aborted) {
        try { await flushObservations(); } catch { if (stop.aborted) break; }
        await options.clock.delay(1000, stop);
      } };
      running ??= Promise.all([outputs(), observations()]).then(() => undefined).catch(() => undefined);
    },
    async close(): Promise<void> { stop.removeEventListener('abort', stopped); await clearTyping(); await running;
      const scope = options.clock.deadline(15000);
      await flushOutput(scope).catch(() => undefined); await flushObservations(scope).catch(() => undefined); },
  };
}
