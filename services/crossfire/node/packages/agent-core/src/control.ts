import type { LocalState } from './port.js';
import type { MessagingClient } from './port.js';
import type { Settings, Account, MessageEvent } from '@ctlflow/crossfire-contracts/client';
import { eventView, incrementalEvents, type ReceivedEvent } from './receive.js';
import type { MessageFeed } from '@ctlflow/crossfire-domain/port/messaging-client';
import { createHash } from 'node:crypto';
import { isListenerNotice, mentionsAgent } from '@ctlflow/crossfire-contracts/notices';
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

export function sourceText(event: MessageEvent | ReceivedEvent, observer: string): boolean {
  return event.type === "message" && event.sender === observer && event.content.kind === "text"
    && !isListenerNotice(event)
    && typeof event.content.body === 'string' && !event.content.edited;
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

export async function* sourceEvents(client: MessagingClient, sync: MessageFeed,
  since: string | undefined, selector?: string): AsyncGenerator<ReceivedEvent> {
  if (!since) return;
  for (const room of Object.keys(sync.rooms)) {
    if (selector && selector !== room) continue;
    for await (const event of incrementalEvents(client, sync, since, room,
      { types: ["message"] })) {
      if (event.type !== "message") continue;
      yield eventView(event, room);
    }
  }
}

export async function isControl(client: MessagingClient, settings: Settings, account: Account, event: ReceivedEvent,
  coordination: Coordination, senders: ReadonlySet<string>, signal: AbortSignal): Promise<boolean> {
  if (!sourceText(event, event.sender) || event.sender === account.userId) return false;
  const mentioned = mentionsAgent(event, account.userId);
  const pause = event.sender === settings.owner && String(event.content.body).trim() === '!!';
  if (!pause && (!senders.has(event.sender) || !mentioned)) return false;
  const identity = (await resolveSenders(coordination, [event], signal)).get(event.sender);
  if (!identity || identity.kind === 'unknown') return false;
  const members = await client.joinedMembers(event.roomId);
  signal.throwIfAborted();
  return members.includes(event.sender) && members.includes(account.userId) && (mentioned || pause && members.length === 2);
}

export function saveControl(storage: LocalState, file: string, state: ControlState): void {
  if (state.controls.length > 1000) throw new Error('Uncheckpointed source controls exceed 1000; drain acknowledged history before continuing');
  if (storage.exists(file) && JSON.stringify(storage.read<unknown>(file)) === JSON.stringify(state)) return;
  storage.write(file, state);
}

export async function publishControlNotice(client: MessagingClient, coordination: Coordination, agentId: string,
  settings: Settings, account: Account, event: ReceivedEvent, signal: AbortSignal): Promise<void> {
  const access = await coordination.delivery(agentId, signal);
  if (!access.ok) throw new Error(access.error.message);
  const view = access.value;
  if (view.agentId !== agentId || view.backendUserId !== account.userId || view.ownerBackendUserId !== settings.owner
    || view.status !== 'active' || view.ownerStatus !== 'active') throw new Error('Agent or owner access is no longer active');
  if (!view.roomGrants.some(grant => grant.roomId === event.roomId && grant.accessMode !== 'read' && !grant.muted)) return;
  try {
    await client.sendNotice(event.roomId, 'crossfire-control-' + createHash('sha256').update(event.eventId).digest('hex'),
      'Listener delivery is paused. This runtime connection cannot interrupt the current turn; stop it in the coding session. A subsequent owner message resumes delivery.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'forbidden')) throw error;
  }
}
