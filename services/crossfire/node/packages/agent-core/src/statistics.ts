import { STATISTICS_INTERVAL_MS, STATISTICS_LIMITS, usageSample, type StatisticsBatch, type TrafficFlow, type UsageSample } from '@ctlflow/crossfire-contracts/statistics';
import type { ReceivedEvent } from './receive.js';
import { isListenerNotice } from '@ctlflow/crossfire-contracts/notices';
import { truncateUtf16 } from '@ctlflow/crossfire-kernel/text';
import { text } from '@ctlflow/crossfire-contracts/schema/validation';

const label = text(100);
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function listenerStatistics(self: string, now: () => number) {
  const flows = new Map<string, TrafficFlow>(), usage = new Map<string, UsageSample>(), recent = new Map<string, { observed: boolean; delivered: boolean }>();
  let startedAt = now(), sequence = 0, dropped = 0, pending: StatisticsBatch | null = null;
  function record(events: readonly ReceivedEvent[], delivered: boolean): void {
    for (const event of events) {
      if (event.type !== "message" || event.sender === self || isListenerNotice(event)) continue;
      const eventKey = JSON.stringify([event.roomId, event.eventId]);
      const previous = recent.get(eventKey) ?? { observed: false, delivered: false };
      if (delivered ? previous.delivered : previous.observed) continue;
      const prefix = typeof event.content.kind === 'string' && event.content.kind.isWellFormed() ? truncateUtf16(event.content.kind, 100) : 'unknown';
      const messageType = label(prefix).ok ? prefix : 'unknown';
      const key = JSON.stringify([event.roomId, event.sender, messageType]);
      let flow = flows.get(key);
      if (!flow && flows.size >= STATISTICS_LIMITS.flows) { dropped++; continue; }
      if (!flow) { flow = { roomId: event.roomId, senderBackendUserId: event.sender, messageType, observed: 0, delivered: 0,
        contentBytes: 0, deliveredBytes: 0, attachmentBytes: 0, largestBytes: 0 }; }
      const next = { ...flow };
      const bytes = event.contentFile?.sourceBytes ?? Buffer.byteLength(JSON.stringify(event.content));
      if (!previous.observed) {
        next.observed++; next.contentBytes += bytes; next.largestBytes = Math.max(next.largestBytes, bytes);
        if (event.contentFile) next.attachmentBytes += event.contentFile.attachmentBytes;
        else next.attachmentBytes += event.content.attachments.reduce((total, attachment) => total + (attachment.bytes ?? 0), 0);
      }
      if (delivered) {
        next.delivered++; next.deliveredBytes += bytes;
      }
      if (!count(next.observed) || !count(next.delivered) || !count(next.contentBytes) || !count(next.deliveredBytes)
        || !count(next.attachmentBytes) || !count(next.largestBytes)) { dropped++; continue; }
      flows.set(key, next);
      recent.delete(eventKey); recent.set(eventKey, { observed: true, delivered: previous.delivered || delivered });
      if (recent.size > STATISTICS_LIMITS.recentEvents) recent.delete(recent.keys().next().value!);
    }
  }
  return {
    observed: (events: readonly ReceivedEvent[]) => record(events, false),
    delivered: (events: readonly ReceivedEvent[]) => record(events, true),
    usage(sample: UsageSample) {
      if (!usageSample(sample).ok) { dropped++; return; }
      const key = JSON.stringify([sample.runtime, sample.sessionId]);
      if (!usage.has(key) && usage.size >= STATISTICS_LIMITS.sessions) { dropped++; return; }
      usage.set(key, sample);
    },
    batch(force = false): StatisticsBatch | null {
      if (pending) return pending;
      const endedAt = Math.max(startedAt, now());
      if (!force && endedAt - startedAt < STATISTICS_INTERVAL_MS || !flows.size && !usage.size && !dropped) return null;
      pending = { sequence: ++sequence, startedAt, endedAt, dropped, flows: [...flows.values()].map(flow => ({ ...flow })), usage: [...usage.values()] };
      flows.clear(); usage.clear(); dropped = 0; startedAt = endedAt;
      return pending;
    },
    acknowledge(batch: StatisticsBatch | null) { if (batch === pending) pending = null; },
  };
}
