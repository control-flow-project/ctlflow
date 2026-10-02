import { randomUUID } from 'node:crypto';
import { API, segment } from '@crossfire/contracts/matrix';
import type { Clock, Matrix } from './port.js';
import type { Json } from '@crossfire/contracts/json';
import { roomId, text } from '@crossfire/contracts/validation';
import type { Account, Event, Settings } from '@crossfire/contracts/client';
import type { ReceivedEvent } from './receive.js';
import type { Permission } from './runtime.js';

import type { Coordination } from './coordination.js';
import { LISTENER_NOTICE } from '@crossfire/contracts/notices';
import { failure, success, type Result } from '@crossfire/kernel/result';
import { ownerConversationState, roomCreators, roomPowers, roomState } from '@crossfire/contracts/matrix-room';

type Pending = {
  room: string; request: string; session: string; expires: number; choices: Permission['choices'];
  complete: (decision: Result<Json>) => void;
};

function reply(event: Event | ReceivedEvent): string | undefined {
  if (event.type !== 'm.room.message' || event.content.msgtype !== 'm.text'
    || event.content['m.new_content'] !== undefined) return;
  const relation = event.content['m.relates_to'];
  if (!relation || typeof relation !== 'object' || Array.isArray(relation) || relation.rel_type !== undefined) return;
  const target = relation['m.in_reply_to'];
  if (!target || typeof target !== 'object' || Array.isArray(target)) return;
  return typeof target.event_id === 'string' ? target.event_id : undefined;
}

function decisionBody(body: string): string {
  const boundary = body.indexOf('\n\n');
  return body.startsWith('> ') && boundary >= 0 && body.slice(0, boundary).split('\n').every(line => line.startsWith('>'))
    ? body.slice(boundary + 2).trim().toLowerCase() : body.trim().toLowerCase();
}

export function permissions(options: { clock: Clock; client: Matrix; coordination: Coordination; settings: Settings; account: Account; agent: string;
  expiresMs: number }, stop: AbortSignal) {
  if (!Number.isInteger(options.expiresMs) || options.expiresMs < 1000 || options.expiresMs > 300_000) {
    throw new Error('A 1000..300000 ms permission expiry is required');
  }
  stop.throwIfAborted();
  const run = randomUUID();
  const pending = new Map<string, Pending>();
  const identities = new Set<string>();
  const consumed = new Set<string>();
  const publications = new Set<Promise<void>>();
  let preparing = 0;
  let conversation: string | null = null;
  async function boundary<Value>(operation: () => Promise<Value>): Promise<Result<Value>> {
    try { return success(await operation()); }
    catch (error) {
      if (stop.aborted) return failure('unavailable', 'Foreground permission run stopped');
      if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
        return failure(error.status === 401 || error.status === 403 ? 'forbidden' : 'unavailable', error.message);
      }
      if (error instanceof Error && 'code' in error && ['native', 'unavailable', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(String(error.code))) {
        return failure('unavailable', error.message);
      }
      throw error;
    }
  }
  async function authorize(expectedRoom?: string, signal = stop): Promise<Result<void>> {
    if (stop.aborted) return failure('unavailable', 'Foreground permission run stopped');
    const parsed = await options.coordination.delivery(options.agent, signal);
    if (!parsed.ok) return parsed;
    const agent = parsed.value;
    if (agent.agentId !== options.agent || agent.ownerMatrixId !== options.settings.owner || agent.matrixUserId !== options.account.user_id
      || agent.status !== 'active' || agent.ownerStatus !== 'active'
      || expectedRoom !== undefined && agent.ownerConversation !== expectedRoom
      || conversation !== null && agent.ownerConversation !== conversation) {
      return failure('forbidden', 'Approval conversation is not currently authorized');
    }
    if (agent.ownerConversation === null) return success(undefined);
    conversation = agent.ownerConversation;
    if (!agent.roomGrants.some(grant => grant.roomId === conversation && grant.accessMode === 'reply' && !grant.muted)) {
      return failure('forbidden', 'Approval conversation read and reply is not currently authorized');
    }
    const base = API + '/rooms/' + segment(conversation);
    const members = await boundary(() => options.client.get<{ joined: Record<string, unknown> }>(base + '/joined_members'));
    if (!members.ok) return members;
    if (!members.value.joined || !Object.hasOwn(members.value.joined, options.settings.owner)
      || !Object.hasOwn(members.value.joined, options.account.user_id) || Object.keys(members.value.joined).length !== 2) return failure('forbidden', 'Approval DMs must contain only the owner and this agent');
    const native = await boundary(() => options.client.get<unknown>(base + '/state'));
    if (!native.ok) return native;
    const state = roomState(native.value);
    if (!state.ok) return state;
    const privacy = ownerConversationState(state.value, options.settings.owner, options.account.user_id);
    if (!privacy.ok) return privacy;
    const creators = roomCreators(state.value);
    if (!creators.ok) return creators;
    const powers = state.value.find(event => event.type === 'm.room.power_levels' && event.state_key === '')?.content;
    if (!powers) return failure('native', 'Native room power levels are missing');
    for (const user of [options.account.user_id, options.settings.owner]) {
      const levels = roomPowers(powers, user);
      if (!levels.ok) return levels;
      if (!creators.value.includes(user) && levels.value.ownerLevel < levels.value.message) {
        return failure('forbidden', 'Approval owner and agent must both have native message permission');
      }
    }
    return stop.aborted ? failure('unavailable', 'Foreground permission run stopped') : success(undefined);
  }
  function close(): void {
    for (const request of [...pending.values()]) request.complete(failure('unavailable', 'Foreground permission run stopped'));
    stop.removeEventListener('abort', close);
  }
  stop.addEventListener('abort', close, { once: true });
  async function request(input: Permission, cancelled: AbortSignal): Promise<Result<Json>> {
    const permission = structuredClone(input);
    if (![permission.runtime, permission.session, permission.request, permission.action].every(value => text(value, 255))
      || permission.choices.length < 1 || permission.choices.length > 16
      || permission.choices.some(choice => !/^[a-z][a-z ]{0,63}$/u.test(choice.label))
      || new Set(permission.choices.map(choice => choice.label)).size !== permission.choices.length
      || Buffer.byteLength(JSON.stringify(permission)) > 12_000) return failure('invalid', 'Invalid or oversized runtime permission');
    const identity = JSON.stringify([permission.runtime, permission.session, permission.request]);
    if (identities.has(identity) || identities.size >= 1000 || pending.size + preparing >= 16) return failure('limit', 'Duplicate or excessive run permissions');
    identities.add(identity);
    const expires = options.clock.now() + options.expiresMs;
    const signal = AbortSignal.any([stop, cancelled, options.clock.deadline(options.expiresMs)]);
    const cancelledResult = () => failure('unavailable', signal.reason instanceof Error ? signal.reason.message : 'Permission expired or disconnected');
    if (signal.aborted) return cancelledResult();
    let published!: () => void;
    const publication = new Promise<void>(resolve => { published = resolve; });
    publications.add(publication);
    preparing++;
    let eventId: string;
    let room: string;
    try {
      const selected = await options.coordination.ownerConversation(options.agent, signal);
      if (!selected.ok) return selected;
      if (!roomId(selected.value.roomId)) return failure('invalid', 'Invalid private owner conversation identity');
      room = selected.value.roomId;
      const authorized = await authorize(room, signal);
      if (!authorized.ok) return authorized;
      if (signal.aborted) return cancelledResult();
      const description = JSON.stringify({ run, runtime: permission.runtime, session: permission.session,
        request: permission.request, action: permission.action, scope: permission.scope,
        choices: permission.choices }, null, 2).split('\n').map(line => '    ' + line).join('\n');
      const sent = await boundary(() => options.client.put<{ event_id: string }>(API + '/rooms/' + segment(room) + '/send/m.room.message/' + randomUUID(),
        { ...options.client.message('**Permission needed.** Reply to this exact message with one choice. Silence is not approval.\n\n'
          + description + '\n\nChoices: ' + permission.choices.map(choice => '`' + choice.label + '`').join(', ')),
          msgtype: 'm.notice', [LISTENER_NOTICE]: true }));
      if (!sent.ok) return sent;
      if (!text(sent.value.event_id, 255) || !sent.value.event_id.startsWith('$')) return failure('invalid', 'Invalid permission announcement identity');
      eventId = sent.value.event_id;
      if (signal.aborted) { consumed.add(eventId); return cancelledResult(); }
    } finally { preparing--; publications.delete(publication); published(); }
    return new Promise<Result<Json>>(resolve => {
      const finish = (decision: Result<Json>) => {
        if (!pending.has(eventId)) return;
        signal.removeEventListener('abort', cancel);
        pending.delete(eventId);
        consumed.add(eventId);
        resolve(decision);
      };
      const cancel = () => finish(cancelledResult());
      pending.set(eventId, { room, request: permission.request, session: permission.session, expires,
        choices: structuredClone(permission.choices), complete: finish });
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  async function consume(event: ReceivedEvent): Promise<boolean> {
    const target = reply(event);
    if (!target) return false;
    await Promise.all(publications);
    if (event.room_id !== conversation) return false;
    if (!pending.has(target) && !consumed.has(target)) return false;
    if (event.sender !== options.settings.owner || consumed.has(target)) return true;
    const current = pending.get(target)!;
    if (event.room_id !== current.room) return false;
    const base = API + '/rooms/' + segment(current.room);
    const original = await boundary(() => options.client.get<Event>(base + '/event/' + segment(event.event_id)));
    if (!original.ok) { current.complete(original); return true; }
    if (original.value.event_id !== event.event_id || original.value.sender !== options.settings.owner || reply(original.value) !== target
      || typeof original.value.content.body !== 'string') return true;
    const choice = current.choices.find(choice => choice.label === decisionBody(original.value.content.body as string));
    if (!choice) return true;
    const authorized = await authorize(current.room);
    if (!authorized.ok) { current.complete(authorized); return true; }
    if (pending.get(target) !== current || options.clock.now() >= current.expires) return true;
    current.complete(success(structuredClone(choice.value)));
    return true;
  }
  return { run, authorize, request, consume, close };
}
