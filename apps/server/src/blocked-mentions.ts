import { createHash } from 'node:crypto';
import type { Event } from '../../../packages/contracts/src/client.js';
import { fields, roomId, text } from '../../../packages/contracts/src/management.js';
import { BLOCKED_MENTION_INTERVAL_MS, BLOCKED_MENTION_NOTICE, mentionsAgent } from '../../../packages/contracts/src/notices.js';
import { failure, success, type Result } from '../../../packages/kernel/src/result.js';
import { API, nativeOk, segment } from '../../../packages/matrix/src/http.js';
import type { Context } from './context.js';
import * as queries from './data/queries.js';
import { completeNotice, notice, noticeCount, reserveNotice } from './data/notices.js';
import { deliverySettings } from './delivery.js';

export async function blockedMention(ctx: Context, id: string, value: unknown): Promise<Result<unknown>> {
  const parsed = fields(value, ['room', 'event']);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!roomId(input.room) || !text(input.event, 255)) return failure('invalid', 'Invalid mention event');
  const initial = queries.agent(ctx.store, id);
  if (!initial) return failure('missing', 'Agent not found');
  const client = await ctx.native.asUser(initial.userId);
  if (!client.ok) return client;
  const fetched = await nativeOk(client.value, 'GET', API + '/rooms/' + segment(input.room) + '/event/' + segment(input.event));
  if (!fetched.ok) return fetched;
  const event = fetched.value as Event;
  if (event.event_id !== input.event || typeof event.sender !== 'string' || !event.content || typeof event.content !== 'object'
    || !mentionsAgent(event, initial.userId)) return success({ status: 'ignored' });
  const reservation = ctx.store.transaction(() => {
    const agent = queries.agent(ctx.store, id)!;
    const policy = deliverySettings(ctx, agent);
    if (policy.status !== 'active' || policy.ownerStatus !== 'active' || policy.senders.includes(event.sender)
      || !policy.grants.some(grant => grant.room === input.room && !grant.muted && grant.access !== 'read')) return undefined;
    const previous = notice(ctx.store, id, event.sender);
    if (previous?.event === event.event_id) return previous.sent ? undefined : previous;
    if (previous && ctx.now() < previous.reserved + BLOCKED_MENTION_INTERVAL_MS) return undefined;
    if (!previous && noticeCount(ctx.store, id) >= 2000) return undefined;
    const owner = queries.member(ctx.store, agent.owner)!;
    const ownerName = owner.label === owner.id ? owner.id : owner.label + ' (' + owner.id + ')';
    const content = { msgtype: 'm.notice', body: event.sender + ', ' + (agent.override ?? agent.name)
      + ' won’t wake under its current rules. ' + ownerName + ' can change them.',
    'm.mentions': { user_ids: [event.sender] }, [BLOCKED_MENTION_NOTICE]: true };
    const next = { agent: id, sender: event.sender, event: event.event_id, room: input.room as string,
      reserved: ctx.now(), content: JSON.stringify(content), sent: 0 };
    reserveNotice(ctx.store, next);
    return next;
  }).immediate();
  if (!reservation) return success({ status: 'suppressed' });
  const transaction = 'crossfire-wake-' + createHash('sha256').update(JSON.stringify([id, reservation.room, reservation.event])).digest('hex');
  const sent = await nativeOk(client.value, 'PUT', API + '/rooms/' + segment(reservation.room) + '/send/m.room.message/' + transaction, JSON.parse(reservation.content));
  if (!sent.ok) return sent;
  completeNotice(ctx.store, id, event.sender, reservation.event);
  return success({ status: 'sent' });
}
