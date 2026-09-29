import { grants } from '../../../packages/contracts/src/management.js';
import type { DeliveryPolicy } from '../../../packages/contracts/src/delivery.js';
import type { Context } from './context.js';
import * as queries from './data/queries.js';
import { wakeSenders } from './data/wake.js';
import { resolveWake } from '../../../packages/contracts/src/wake.js';
import { activeIdentities } from './identities.js';

export function deliverySettings(ctx: Context, agent: NonNullable<ReturnType<typeof queries.agent>>): DeliveryPolicy {
  const access = grants(JSON.parse(agent.grants));
  if (!access.ok) throw new Error('Corrupt stored agent grants');
  const owner = queries.member(ctx.store, agent.owner);
  if (!owner) throw new Error('Agent owner is missing');
  const senders = resolveWake(agent.wakePolicy, wakeSenders(ctx.store, agent.id), owner.id, agent.userId, activeIdentities(ctx));
  return { id: agent.id, owner: agent.owner, userId: agent.userId, status: agent.status, ownerStatus: owner.status,
    grants: access.value, wakePolicy: agent.wakePolicy, senders };
}
