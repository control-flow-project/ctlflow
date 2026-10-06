import type { LocalState } from './port.js';
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import type { Matrix } from './port.js';
import type { Settings, Account, Event } from '@ctlflow/crossfire-contracts/client';
import { eventView, incrementalEvents, type ReceivedEvent, type Sync } from './receive.js';
import { createHash } from 'node:crypto';
import { LISTENER_NOTICE, mentionsAgent } from '@ctlflow/crossfire-contracts/notices';
import type { Coordination } from './coordination.js';
import { resolveSenders } from './senders.js';

export type Control = {
  room: string;
  event: string;
  stop: boolean;
  turn: string | null;
  status: 'interrupting' | 'interrupted' | 'delivered' | 'superseded';
};
export type ControlState = { thread: string; paused: boolean; controls: Control[] };

export function humanText(event: Event | ReceivedEvent, observer: string): boolean {
  return event.type === 'm.room.message' && event.sender === observer && event.content.msgtype === 'm.text'
    && typeof event.content.body === 'string' && !event.content['m.new_content']
    && !(event.content['m.relates_to'] && typeof event.content['m.relates_to'] === 'object'
      && !Array.isArray(event.content['m.relates_to']) && event.content['m.relates_to'].rel_type === 'm.replace');
}

export function loadControl(storage: LocalState, path: string, thread: string): ControlState {
  if (!storage.exists(path)) return { thread, paused: false, controls: [] };
  const state = storage.read<ControlState>(path);
  if (!state || state.thread !== thread || typeof state.paused !== 'boolean' || !Array.isArray(state.controls)
      || state.controls.length > 1000
      || state.controls.some(control => !control || typeof control.room !== 'string' || typeof control.event !== 'string'
        || typeof control.stop !== 'boolean' || (control.turn !== null && typeof control.turn !== 'string')
        || !['interrupting', 'interrupted', 'delivered', 'superseded'].includes(control.status))) throw new Error('Invalid or different-thread control state');
  return state;
}

export async function* humanEvents(client: Matrix, sync: Sync,
  since: string | undefined, selector?: string): AsyncGenerator<ReceivedEvent> {
  if (!since) return;
  for (const [room, data] of Object.entries(sync.rooms?.join ?? {})) {
    if (selector && selector !== room) continue;
    const timeline = data.timeline;
    if (!timeline) continue;
    for await (const event of incrementalEvents(client, sync, since, room,
      { types: ['m.room.message'] })) {
      if (!humanText(event, event.sender)) continue;
      yield eventView(event, room);
    }
  }
}

export async function isControl(client: Matrix, settings: Settings, account: Account, event: ReceivedEvent,
  coordination: Coordination, senders: ReadonlySet<string>, signal: AbortSignal): Promise<boolean> {
  if (!humanText(event, event.sender) || event.sender === account.user_id) return false;
  const mentioned = mentionsAgent(event, account.user_id);
  const pause = event.sender === settings.owner && String(event.content.body).trim() === '!!';
  if (!pause && !(mentioned && senders.has(event.sender))) return false;
  const identity = (await resolveSenders(coordination, [event], signal)).get(event.sender);
  if (identity?.kind !== 'human') return false;
  const joined = (await client.get<{ joined: Record<string, unknown> }>(`${API}/rooms/${segment(event.room_id)}/joined_members`)).joined;
  const members = Object.keys(joined);
  signal.throwIfAborted();
  return members.includes(event.sender) && members.includes(account.user_id) && (mentioned || pause && members.length === 2);
}

export function saveControl(storage: LocalState, file: string, state: ControlState): void {
  if (state.controls.length > 1000) throw new Error('Uncheckpointed human controls exceed 1000; drain acknowledged history before continuing');
  if (storage.exists(file) && JSON.stringify(storage.read<unknown>(file)) === JSON.stringify(state)) return;
  storage.write(file, state);
}

export async function publishControlNotice(client: Matrix, coordination: Coordination, agentId: string,
  settings: Settings, account: Account, event: ReceivedEvent, signal: AbortSignal): Promise<void> {
  const access = await coordination.delivery(agentId, signal);
  if (!access.ok) throw new Error(access.error.message);
  const view = access.value;
  if (view.agentId !== agentId || view.matrixUserId !== account.user_id || view.ownerMatrixId !== settings.owner
    || view.status !== 'active' || view.ownerStatus !== 'active') throw new Error('Agent or owner access is no longer active');
  if (!view.roomGrants.some(grant => grant.roomId === event.room_id && grant.accessMode !== 'read' && !grant.muted)) return;
  try {
    await client.put(`${API}/rooms/${segment(event.room_id)}/send/m.room.message/${segment('crossfire-control-' + createHash('sha256').update(event.event_id).digest('hex'))}`,
      { msgtype: 'm.notice', [LISTENER_NOTICE]: true,
        body: 'Listener delivery is paused. This runtime connection cannot interrupt the current turn; stop it in the coding session. A subsequent owner message resumes delivery.' });
  } catch (error) {
    if (!(error instanceof Error && 'status' in error && error.status === 403)) throw error;
  }
}
