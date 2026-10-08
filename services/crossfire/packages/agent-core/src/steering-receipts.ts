import type { ReceivedEvent } from './receive.js';

export type SteeringStage = 'received' | 'interrupted' | 'already-idle' | 'accepted' | 'superseded' | 'failed';
export function steeringReceipts(now: () => number, notice: (id: string, text: string) => void) {
  const received = new Map<string, number>();
  const publish = (event: ReceivedEvent, stage: SteeringStage, detail?: string): void => {
    const key = JSON.stringify([event.room_id, event.event_id]);
    const at = now();
    const first = received.get(key) ?? (stage === 'received' ? at : null);
    if (stage === 'received') received.set(key, first ?? at);
    const sent = event.timestamp === null ? null : Date.parse(event.timestamp);
    const label = { received: 'Mention received', interrupted: 'Captured turn interrupted', 'already-idle': 'Already idle — no turn interrupted',
      accepted: 'Native input accepted', superseded: 'Steering superseded — retained as unread context', failed: 'Steering failed — native acceptance not confirmed' }[stage];
    const text = label + '\n' + JSON.stringify({ eventId: event.event_id, source: event.origin, roomId: event.room_id,
      sender: event.sender, sentAt: event.timestamp, receivedAt: first === null ? null : new Date(first).toISOString(), stageAt: new Date(at).toISOString(),
      sinceReceiptMs: first === null ? null : Math.max(0, at - first), sinceSentMs: sent === null ? null : Math.max(0, at - sent),
      ...(stage === 'received' ? { message: String(event.content.body).slice(0, 3000) } : {}), ...(detail ? { detail: detail.slice(0, 3000) } : {}) });
    notice(JSON.stringify(['steering', key, stage]), text);
    if (stage === 'accepted' || stage === 'superseded') received.delete(key);
  };
  return { publish, superseded(room: string, event: string, replacement: ReceivedEvent): void {
    received.delete(JSON.stringify([room, event]));
    notice(JSON.stringify(['steering', JSON.stringify([room, event]), 'superseded']),
      'Steering superseded by a newer mention. Confirmed input remains in native history; unconfirmed input remains unread.\n'
      + JSON.stringify({ roomId: room, eventId: event, replacedBy: replacement.event_id, stageAt: new Date(now()).toISOString() }));
  } };
}
