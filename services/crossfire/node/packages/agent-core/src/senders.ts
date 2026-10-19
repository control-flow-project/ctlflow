import { principalIdentities, type PrincipalIdentity } from '@ctlflow/crossfire-contracts/schema/response';
import type { Coordination } from './coordination.js';
import { isListenerNotice } from '@ctlflow/crossfire-contracts/notices';
import type { ReceivedEvent } from './receive.js';

export function deliveryEvents(events: readonly ReceivedEvent[], self: string): ReceivedEvent[] {
  return events.filter(event => !(event.sender === self && event.type === "message") && !isListenerNotice(event));
}

export async function resolveSenders(coordination: Coordination, events: readonly ReceivedEvent[], signal: AbortSignal) {
  const backendUserIds = [...new Set(events.map(event => event.sender))];
  const identities = new Map<string, PrincipalIdentity>();
  for (let offset = 0; offset < backendUserIds.length; offset += 100) {
    const requested = backendUserIds.slice(offset, offset + 100);
    const result = await coordination.identities(requested, signal);
    if (!result.ok) throw new Error(result.error.message);
    const checked = principalIdentities(result.value);
    if (!checked.ok) throw new Error(checked.error.message);
    const expected = new Set(requested);
    if (checked.value.length !== requested.length || checked.value.some(identity => !expected.has(identity.backendUserId))) {
      throw new Error('Sender identity response does not match the requested Messaging senders');
    }
    for (const identity of checked.value) identities.set(identity.backendUserId, identity);
  }
  return identities;
}
