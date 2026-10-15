import assert from 'node:assert/strict';
import test from 'node:test';
import { steeringReceipts } from '@ctlflow/crossfire-agent-core/steering-receipts';
import { eventView } from '@ctlflow/crossfire-agent-core/receive';
import { message, ROOM } from '../scripts/test-support/listener.js';

test('steering receipts retain exact source, deterministic stage identity and actual observed timings', () => {
  let now = 1000;
  const notices: { id: string; text: string }[] = [];
  const receipts = steeringReceipts(() => now, (id, text) => notices.push({ id, text }));
  const event = { ...eventView(message('$steering'), ROOM), origin: { kind: 'room' as const, name: 'Review', alias: null } };
  receipts.publish(event, 'received'); now += 25; receipts.publish(event, 'interrupted');
  now += 10; receipts.publish(event, 'accepted');
  const detail = JSON.parse(notices[2]!.text.split('\n')[1]!) as { eventId: string; sender: string; source: typeof event.origin; receivedAt: string; sinceReceiptMs: number };
  assert.equal(detail.eventId, event.event_id); assert.equal(detail.sender, event.sender); assert.deepEqual(detail.source, event.origin);
  assert.equal(detail.receivedAt, new Date(1000).toISOString()); assert.equal(detail.sinceReceiptMs, 35);
  assert.equal(new Set(notices.map(notice => notice.id)).size, 3);
  const restarted = steeringReceipts(() => now, (id, text) => notices.push({ id, text }));
  restarted.publish(event, 'accepted');
  const recovered = JSON.parse(notices[3]!.text.split('\n')[1]!) as { receivedAt: string | null; sinceReceiptMs: number | null };
  assert.equal(notices[3]!.id, notices[2]!.id); assert.equal(recovered.receivedAt, null); assert.equal(recovered.sinceReceiptMs, null);
});
