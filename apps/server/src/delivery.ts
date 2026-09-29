import { grants } from '../../../packages/contracts/src/management.js';
import type { DeliveryPolicy } from '../../../packages/contracts/src/delivery.js';
import type { Context } from './context.js';
import * as queries from './data/queries.js';

export function deliverySettings(ctx: Context, agent: NonNullable<ReturnType<typeof queries.agent>>): DeliveryPolicy {
  const access = grants(JSON.parse(agent.grants));
  if (!access.ok) throw new Error('Corrupt stored agent grants');
  const owner = queries.member(ctx.store, agent.owner);
  if (!owner) throw new Error('Agent owner is missing');
  const humans = new Set(queries.members(ctx.store).filter(member => member.status === 'active').map(member => member.id));
  const senders = new Set<string>();
  if (humans.has(owner.id)) senders.add(owner.id);
  if (agent.wakePolicy === 'humans' || agent.wakePolicy === 'everyone') for (const human of humans) senders.add(human);
  if (agent.wakePolicy !== 'owner') {
    for (const peer of queries.agents(ctx.store, agent.owner, agent.wakePolicy === 'everyone')) {
      if (peer.status === 'active' && humans.has(peer.owner) && peer.userId !== agent.userId) senders.add(peer.userId);
    }
  }
  senders.delete(agent.userId);
  return { id: agent.id, owner: agent.owner, userId: agent.userId, status: agent.status, ownerStatus: owner.status,
    grants: access.value, wakePolicy: agent.wakePolicy, senders: [...senders].sort() };
}
