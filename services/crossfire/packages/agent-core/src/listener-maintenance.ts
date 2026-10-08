import type { Coordination } from './coordination.js';
import type { Clock, LocalState } from './port.js';
import type { ReceivedEvent, Sync } from './receive.js';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';

export function listenerMaintenance(options: { clock: Clock; interval: number; storage: LocalState; file: string; agentId: string; coordination: Coordination;
  invitationRooms: (signal: AbortSignal) => Promise<readonly string[]> }) {
  const invitations = new Map<string, number>(), notices = new Map<string, { room: string; event: string }>();
  const journalBytes = 24 * 1024 * 1024;
  if (options.storage.exists(options.file)) {
    const saved = check.list(check.object({ room: check.roomId, event: check.eventId }), 10000)(options.storage.read<unknown>(options.file, journalBytes));
    if (!saved.ok) throw new Error('Invalid listener maintenance journal');
    for (const notice of saved.value) notices.set(JSON.stringify([notice.room, notice.event]), notice);
    if (notices.size !== saved.value.length) throw new Error('Duplicate listener maintenance notice identity');
  }
  function save(): void {
    if (notices.size) options.storage.write(options.file, [...notices.values()], journalBytes);
    else options.storage.remove(options.file);
  }
  let requested = 0, checked = -1, lastCheck = -Infinity;
  return {
    observe(sync: Sync): void {
      if (Object.keys(sync.rooms?.invite ?? {}).length || Object.keys(sync.rooms?.leave ?? {}).length) requested++;
    },
    notice(event: ReceivedEvent): void {
      const identity = JSON.stringify([event.room_id, event.event_id]);
      if (notices.has(identity)) return;
      if (notices.size >= 10000) throw Object.assign(new Error('Pending blocked-mention notices exceed the bounded ordinary queue'), { code: 'unavailable' });
      notices.set(identity, { room: event.room_id, event: event.event_id });
      save();
    },
    pending: () => notices.size > 0 || requested !== checked || options.clock.now() - lastCheck >= options.interval
      || [...invitations.values()].some(at => options.clock.now() - at >= options.interval),
    async publish(signal: AbortSignal): Promise<boolean> {
      let joined = false;
      if (requested !== checked || options.clock.now() - lastCheck >= options.interval) {
        const revision = requested, pending = new Set(await options.invitationRooms(signal));
        signal.throwIfAborted();
        for (const room of invitations.keys()) if (!pending.has(room)) invitations.delete(room);
        for (const room of pending) if (!invitations.has(room)) invitations.set(room, -Infinity);
        checked = revision; lastCheck = options.clock.now();
      }
      let attempted = 0;
      for (const [room, previous] of invitations) {
        if (options.clock.now() - previous < options.interval) continue;
        if (attempted++ >= 10) break;
        const accepted = await options.coordination.acceptInvitation(options.agentId, room, signal);
        signal.throwIfAborted();
        if (!accepted.ok && !['forbidden', 'missing', 'conflict', 'limit'].includes(accepted.error.code)) {
          throw Object.assign(new Error(accepted.error.message), { code: accepted.error.code });
        }
        invitations.set(room, options.clock.now());
        if (accepted.ok && accepted.value.accepted) { invitations.delete(room); joined = true; }
      }
      for (const [identity, notice] of notices) {
        signal.throwIfAborted();
        const result = await options.coordination.notice(options.agentId, notice.room, notice.event, signal);
        signal.throwIfAborted();
        if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
        notices.delete(identity); save();
      }
      return joined;
    },
  };
}
