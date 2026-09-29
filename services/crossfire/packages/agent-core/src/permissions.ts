import { randomUUID } from 'node:crypto';
import { API, segment } from '@crossfire/contracts/matrix';
import type { Matrix } from './port.js';
import type { Json } from '@crossfire/contracts/json';
import { roomId, text } from '@crossfire/contracts/validation';
import type { Account, Event, Settings } from '@crossfire/contracts/client';
import type { ReceivedEvent } from './receive.js';
import type { Permission } from './runtime.js';

import type { Coordination } from './coordination.js';

type Pending = {
  request: string; session: string; expires: number; choices: Permission['choices'];
  complete: (decision: Json) => void; cancel: (error: Error) => void;
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

export function permissions(options: { client: Matrix; coordination: Coordination; settings: Settings; account: Account; agent: string;
  room: string; expiresMs: number }, stop: AbortSignal) {
  if (!roomId(options.room) || !Number.isInteger(options.expiresMs) || options.expiresMs < 1000 || options.expiresMs > 300_000) {
    throw new Error('An explicit approval room and a 1000..300000 ms expiry are required');
  }
  stop.throwIfAborted();
  const run = randomUUID();
  const pending = new Map<string, Pending>();
  const identities = new Set<string>();
  const consumed = new Set<string>();
  const publications = new Set<Promise<void>>();
  let preparing = 0;
  const base = API + '/rooms/' + segment(options.room);
  async function authorize(): Promise<void> {
    stop.throwIfAborted();
    const parsed = await options.coordination.delivery(options.agent, stop);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const agent = parsed.value;
    if (agent.agentId !== options.agent || agent.ownerMatrixId !== options.settings.owner || agent.matrixUserId !== options.account.user_id
      || agent.status !== 'active' || agent.ownerStatus !== 'active'
      || !agent.roomGrants.some(grant => grant.roomId === options.room && grant.accessMode !== 'read' && !grant.muted)) {
      throw new Error('Approval conversation is not currently authorized');
    }
    const members = await options.client.get<{ joined: Record<string, unknown> }>(base + '/joined_members');
    if (!members.joined || !Object.hasOwn(members.joined, options.settings.owner)
      || !Object.hasOwn(members.joined, options.account.user_id)) throw new Error('Approval owner and agent must both be joined');
    stop.throwIfAborted();
  }
  function close(): void {
    for (const request of [...pending.values()]) request.cancel(new Error('Foreground permission run stopped'));
    stop.removeEventListener('abort', close);
  }
  stop.addEventListener('abort', close, { once: true });
  async function request(input: Permission, cancelled: AbortSignal): Promise<Json> {
    const permission = structuredClone(input);
    if (![permission.runtime, permission.session, permission.request, permission.action].every(value => text(value, 255))
      || permission.choices.length < 1 || permission.choices.length > 16
      || permission.choices.some(choice => !/^[a-z][a-z ]{0,63}$/u.test(choice.label))
      || new Set(permission.choices.map(choice => choice.label)).size !== permission.choices.length
      || Buffer.byteLength(JSON.stringify(permission)) > 12_000) throw new Error('Invalid or oversized runtime permission');
    const identity = JSON.stringify([permission.runtime, permission.session, permission.request]);
    if (identities.has(identity) || identities.size >= 1000 || pending.size + preparing >= 16) throw new Error('Duplicate or excessive run permissions');
    identities.add(identity);
    const expires = performance.now() + options.expiresMs;
    const signal = AbortSignal.any([stop, cancelled, AbortSignal.timeout(options.expiresMs)]);
    signal.throwIfAborted();
    let published!: () => void;
    const publication = new Promise<void>(resolve => { published = resolve; });
    publications.add(publication);
    preparing++;
    let eventId: string;
    try {
      await authorize();
      signal.throwIfAborted();
      const description = JSON.stringify({ run, runtime: permission.runtime, session: permission.session,
        request: permission.request, action: permission.action, scope: permission.scope,
        choices: permission.choices }, null, 2).split('\n').map(line => '    ' + line).join('\n');
      const sent = await options.client.put<{ event_id: string }>(base + '/send/m.room.message/' + randomUUID(),
        options.client.message('**Permission needed.** Reply to this exact message with one choice. Silence is not approval.\n\n'
          + description + '\n\nChoices: ' + permission.choices.map(choice => '`' + choice.label + '`').join(', ')));
      if (!text(sent.event_id, 255) || !sent.event_id.startsWith('$')) throw new Error('Invalid permission announcement identity');
      eventId = sent.event_id;
      signal.throwIfAborted();
    } finally { preparing--; publications.delete(publication); published(); }
    return new Promise<Json>((resolve, reject) => {
      const finish = (decision: Json | Error) => {
        signal.removeEventListener('abort', cancel);
        pending.delete(eventId);
        consumed.add(eventId);
        if (decision instanceof Error) reject(decision); else resolve(decision);
      };
      const cancel = () => finish(signal.reason instanceof Error ? signal.reason : new Error('Permission expired or disconnected'));
      pending.set(eventId, { request: permission.request, session: permission.session, expires,
        choices: structuredClone(permission.choices), complete: finish, cancel: finish });
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  async function consume(event: ReceivedEvent): Promise<boolean> {
    const target = reply(event);
    if (event.room_id !== options.room || !target) return false;
    await Promise.all(publications);
    if (!pending.has(target) && !consumed.has(target)) return false;
    if (event.sender !== options.settings.owner || consumed.has(target)) return true;
    const current = pending.get(target)!;
    const original = await options.client.get<Event>(base + '/event/' + segment(event.event_id));
    if (original.event_id !== event.event_id || original.sender !== options.settings.owner || reply(original) !== target
      || typeof original.content.body !== 'string') return true;
    const choice = current.choices.find(choice => choice.label === decisionBody(original.content.body as string));
    if (!choice) return true;
    await authorize();
    if (pending.get(target) !== current || performance.now() >= current.expires) return true;
    current.complete(structuredClone(choice.value));
    return true;
  }
  return { run, authorize, request, consume, close };
}
