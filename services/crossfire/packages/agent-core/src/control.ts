import type { LocalState } from './port.js';
import { API, segment } from '@crossfire/contracts/matrix';
import type { Matrix } from './port.js';
import type { Settings, Account, Event } from '@crossfire/contracts/client';
import { eventView, incrementalEvents, type ReceivedEvent, type Sync } from './receive.js';
import { MAX_JSON_BYTES } from '@crossfire/contracts/limits';

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
    && typeof event.content.body === 'string' && !event.content['m.relates_to'] && !event.content['m.new_content'];
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

export async function humanEvents(client: Matrix, settings: Settings, sync: Sync, since: string | undefined,
  selector?: string): Promise<ReceivedEvent[]> {
  if (!since) return [];
  const result: ReceivedEvent[] = [];
  for (const [room, data] of Object.entries(sync.rooms?.join ?? {})) {
    if (selector && selector !== room) continue;
    const timeline = data.timeline;
    if (!timeline) continue;
    const events = await incrementalEvents(client, sync, since, room, { types: ['m.room.message'], senders: [settings.owner] });
    for (const event of events) {
      if (event.sender !== settings.owner || event.content.msgtype !== 'm.text'
        || typeof event.content.body !== 'string' || event.content['m.new_content']) continue;
      result.push(eventView(event, room));
      if (result.length > 1000 || Buffer.byteLength(JSON.stringify(result)) > MAX_JSON_BYTES) throw new Error('Human-control acquisition budget exceeded');
    }
  }
  return result.sort((left, right) => (left.timestamp ?? '').localeCompare(right.timestamp ?? ''));
}

export async function isControl(client: Matrix, settings: Settings, account: Account, event: ReceivedEvent): Promise<boolean> {
  if (!humanText(event, settings.owner) || !/^!!(?: |$)/u.test(String(event.content.body))) return false;
  const mentions = event.content['m.mentions'];
  if (mentions && typeof mentions === 'object' && !Array.isArray(mentions)
      && Array.isArray((mentions as Record<string, unknown>).user_ids)
      && ((mentions as Record<string, unknown>).user_ids as unknown[]).includes(account.user_id)) return true;
  const joined = (await client.get<{ joined: Record<string, unknown> }>(`${API}/rooms/${segment(event.room_id)}/joined_members`)).joined;
  const members = Object.keys(joined);
  return members.length === 2 && members.includes(settings.owner) && members.includes(account.user_id);
}

export function saveControl(storage: LocalState, file: string, state: ControlState): void {
  if (state.controls.length > 1000) throw new Error('Uncheckpointed human controls exceed 1000; drain acknowledged history before continuing');
  if (storage.exists(file) && JSON.stringify(storage.read<unknown>(file)) === JSON.stringify(state)) return;
  storage.write(file, state);
}
