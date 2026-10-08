import { randomUUID } from 'node:crypto';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import type { LocalState, Transport } from './port.js';
import type { Account, Settings } from '@ctlflow/crossfire-contracts/client';
import type { Coordination } from './coordination.js';
import { readUnread, loadCursors, acknowledge, acquisitionBytes, eventView, validatePage, joinedRooms, validReadBatch, validCursors, roomQuota, type ReadBatch } from './receive.js';
import { historyPage, HISTORY_RESOURCE_BYTES } from './history-page.js';
import { eventOrigins } from './origins.js';
import { resolveSenders } from './senders.js';
import { deliveryEnvelope } from './receive.js';
import type { MessageArtifacts } from './message-artifacts.js';

export const historyRequest = check.object({ kind: check.choice('unread', 'history'), room: check.optional(check.roomId),
  limit: check.integer(1, 100), outputBytes: check.integer(1024, 98304), direction: check.choice('b', 'f'),
  cursors: check.refine(check.object({ entries: check.list(check.object({ room: check.roomId, cursor: check.text(4096) }), 1000) }),
    value => new Set(value.entries.map(entry => entry.room)).size === value.entries.length, 'Duplicate room continuations') });
export type HistoryRequest = check.Parsed<typeof historyRequest>;
type Pending = { id: string; base: Record<string, string>; batch: ReadBatch; messageId: string; expiresAt: number; stage: 'prepared' | 'acknowledging' };
function readPending(storage: LocalState, file: string): Pending {
  const value = storage.read<unknown>(file, HISTORY_RESOURCE_BYTES);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pending unread query');
  const pending = value as Partial<Pending>;
  if (!check.identifier(pending.id).ok || !validCursors(pending.base) || !validReadBatch(pending.batch)
    || pending.messageId !== 'query-' + pending.id || !check.integer()(pending.expiresAt).ok
    || !check.choice('prepared', 'acknowledging')(pending.stage).ok) throw new Error('Invalid pending unread query');
  return pending as Pending;
}
export function historyQueries(options: { storage: LocalState; file: string; transport: Transport; signal: AbortSignal; coordination: Coordination;
  account: Account; settings: Settings; agentId: string; now: () => number; publishing: () => boolean; artifacts: MessageArtifacts;
  observed?: (events: readonly ReadBatch['events'][number][]) => void; delivered?: (events: readonly ReadBatch['events'][number][]) => void; acknowledged?: () => void }) {
  const pendingFile = options.file + '.query', artifacts = options.artifacts;
  let reading = false;
  function operationSignal(cancelled?: AbortSignal): AbortSignal {
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30000), ...(cancelled ? [cancelled] : [])]);
    signal.throwIfAborted();
    return signal;
  }
  function expire() {
    if (!options.storage.exists(pendingFile)) return;
    const pending = readPending(options.storage, pendingFile);
    if (pending.stage === 'prepared' && pending.expiresAt <= options.now()) { options.storage.remove(pendingFile); artifacts.release([pending.messageId]); }
  }
  async function acknowledgeQuery(id: string, cancelled?: AbortSignal): Promise<Result<{ accepted: true }>> {
    if (reading) return failure('conflict', 'Another receiver query is in progress');
    const signal = operationSignal(cancelled), client = options.transport(signal, 30000);
    reading = true;
    try {
      expire();
      if (!options.storage.exists(pendingFile)) return failure('missing', 'Unread query not found');
      const pending = readPending(options.storage, pendingFile);
      if (pending.id !== id) return failure('conflict', 'Unread query identity changed');
      const policy = await options.coordination.delivery(options.agentId, signal);
      signal.throwIfAborted();
      if (!policy.ok) return policy;
      if (policy.value.matrixUserId !== options.account.user_id || policy.value.ownerMatrixId !== options.settings.owner
        || policy.value.status !== 'active' || policy.value.ownerStatus !== 'active') return failure('forbidden', 'Agent access is no longer active');
      const joined = new Set(await joinedRooms(client));
      const allowed = new Set(policy.value.roomGrants.filter(grant => joined.has(grant.roomId)).map(grant => grant.roomId));
      if (pending.batch.events.some(event => !allowed.has(event.room_id))) {
        options.storage.remove(pendingFile); artifacts.release([pending.messageId]);
        return failure('forbidden', 'Room access changed before query acknowledgment');
      }
      const current = JSON.stringify(loadCursors(options.storage, options.file));
      if (options.publishing() || current !== JSON.stringify(pending.base)
        && (pending.stage !== 'acknowledging' || current !== JSON.stringify(pending.batch.cursors))) return failure('conflict', 'Delivery checkpoints changed; the unread query was not acknowledged');
      signal.throwIfAborted();
      pending.stage = 'acknowledging'; options.storage.write(pendingFile, pending, HISTORY_RESOURCE_BYTES);
      await acknowledge(options.storage, client, options.file, pending.batch);
      options.delivered?.(pending.batch.events);
      options.storage.remove(pendingFile); artifacts.release([pending.messageId]);
      options.acknowledged?.();
      return success({ accepted: true });
    } finally { reading = false; }
  }
  return {
    contentFiles: () => options.storage.exists(pendingFile) ? readPending(options.storage, pendingFile).batch.events.flatMap(event => event.content_file ? [event.content_file.file] : []) : [],
    async read(input: HistoryRequest, cancelled?: AbortSignal) {
      expire();
      if (reading || input.kind === 'unread' && options.publishing()) return failure('conflict', 'The receiver is settling another publication; use history browsing or retry catch-up after settlement');
      const signal = operationSignal(cancelled), client = options.transport(signal, 30000);
      reading = true;
      try {
        const policy = await options.coordination.delivery(options.agentId, signal);
        signal.throwIfAborted();
        if (!policy.ok) return policy;
        if (policy.value.matrixUserId !== options.account.user_id || policy.value.ownerMatrixId !== options.settings.owner
          || policy.value.status !== 'active' || policy.value.ownerStatus !== 'active') return failure('forbidden', 'Agent access is not active');
        const joined = new Set(await joinedRooms(client));
        const allowed = new Set(policy.value.roomGrants.filter(grant => joined.has(grant.roomId)).map(grant => grant.roomId));
        if (input.room && !allowed.has(input.room) || input.cursors.entries.some(entry => !allowed.has(entry.room))) return failure('forbidden', 'Requested room is outside current agent access');
        let batch: ReadBatch;
        if (input.kind === 'unread') {
          if (options.storage.exists(pendingFile)) return failure('conflict', 'A previous unread query needs its acknowledgment before another catch-up');
          if (input.cursors.entries.length) return failure('invalid', 'Unread queries use saved delivery checkpoints, not supplied history cursors');
          batch = await readUnread(options.storage, client, options.settings, options.file, input.limit, input.room, policy.value.maxMessageBytes, undefined, allowed, undefined, artifacts.stage);
        } else {
          const rooms = input.room ? [input.room] : [...allowed].sort(), cursors = Object.fromEntries(input.cursors.entries.map(entry => [entry.room, entry.cursor]));
          let events: ReadBatch['events'] = [], fileMode = false;
          const more_rooms: string[] = [], next: Record<string, string> = {};
          for (const [position, room] of rooms.entries()) {
            const page = await historyPage(client, room, { dir: input.direction, limit: roomQuota(input.limit, rooms.length, position),
              ...(cursors[room] ? { from: cursors[room]! } : {}) });
            validatePage(page, page.requestedLimit, cursors[room]);
            let messages = page.chunk.map(event => eventView(event, room));
            if (fileMode || acquisitionBytes([...events, ...messages], options.settings) > policy.value.maxMessageBytes) {
              fileMode = true; events = artifacts.stage(events); messages = artifacts.stage(messages);
            }
            events.push(...messages);
            if (page.end) next[room] = page.end;
            if (page.chunk.length >= page.requestedLimit) more_rooms.push(room);
          }
          batch = { events, cursors: next, more_rooms, latest: {} };
        }
        const events = await eventOrigins(client, options.account.user_id, batch.events);
        if (input.kind === 'unread') options.observed?.(events);
        const identities = await resolveSenders(options.coordination, events, signal);
        signal.throwIfAborted();
        const envelope = { ...deliveryEnvelope(events, options.settings, identities), more_rooms: batch.more_rooms,
          continuation: { entries: Object.entries(batch.cursors).filter(([room]) => allowed.has(room)).map(([room, cursor]) => ({ room, cursor })) } };
        const id = randomUUID(), messageId = 'query-' + id;
        const maximum = Math.min(input.outputBytes - 1, policy.value.maxMessageBytes);
        const { events: _events, ...metadata } = envelope;
        const text = artifacts.prepare(events, JSON.stringify(envelope, null, 2), messageId, maximum, metadata);
        if (input.kind === 'unread') options.storage.write(pendingFile, { id, base: loadCursors(options.storage, options.file), batch, messageId, expiresAt: options.now() + 300000, stage: 'prepared' }, HISTORY_RESOURCE_BYTES);
        else artifacts.release([messageId]);
        return success({ queryId: input.kind === 'unread' ? id : null, text });
      } finally { reading = false; }
    },
    acknowledge: acknowledgeQuery,
    recovering: () => !reading && options.storage.exists(pendingFile) && readPending(options.storage, pendingFile).stage === 'acknowledging',
    async recover(cancelled?: AbortSignal) {
      if (reading || !options.storage.exists(pendingFile)) return success(undefined);
      const pending = readPending(options.storage, pendingFile);
      if (pending.stage !== 'acknowledging') return success(undefined);
      const result = await acknowledgeQuery(pending.id, cancelled);
      return result.ok ? success(undefined) : result;
    },
    pending() {
      expire();
      return reading || options.storage.exists(pendingFile);
    },
  };
}
export type HistoryQueries = ReturnType<typeof historyQueries>;
