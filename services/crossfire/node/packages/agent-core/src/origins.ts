import type { MessagingClient } from './port.js';
import type { ReceivedEvent } from './receive.js';

export async function eventOrigins(client: MessagingClient, self: string, events: readonly ReceivedEvent[]): Promise<ReceivedEvent[]> {
  const origins = await client.origins(self, [...new Set(events.map(event => event.roomId))]);
  return events.map(event => {
    if (!Object.hasOwn(origins, event.roomId)) throw new Error('Backend omitted required message-origin evidence');
    return { ...event, origin: origins[event.roomId]! };
  });
}
