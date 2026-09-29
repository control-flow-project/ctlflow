import type { WakeAuthor } from '../../../packages/contracts/src/wake.js';
import type { Context } from './context.js';
import * as queries from './data/queries.js';

export function activeIdentities(ctx: Context): WakeAuthor[] {
  const members = queries.members(ctx.store).filter(member => member.status === 'active');
  const humans = new Map(members.map(member => [member.id, member]));
  return [...members.map(member => ({ id: member.id, label: member.label, kind: 'human' as const, owner: member.id })),
    ...queries.agents(ctx.store, '', true).filter(agent => agent.status === 'active' && humans.has(agent.owner))
      .map(agent => ({ id: agent.userId, label: agent.override ?? agent.name + ' (' + humans.get(agent.owner)!.label + ')', kind: 'agent' as const, owner: agent.owner }))];
}
