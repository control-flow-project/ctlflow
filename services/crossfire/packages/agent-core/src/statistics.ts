import { STATISTICS_INTERVAL_MS, STATISTICS_LIMITS, usageSample, type StatisticsBatch, type TrafficFlow, type UsageSample } from '@ctlflow/crossfire-contracts/statistics';
import type { ReceivedEvent } from './receive.js';
import { isListenerNotice } from '@ctlflow/crossfire-contracts/notices';

export function listenerStatistics(self: string, now: () => number) {
  const flows = new Map<string, TrafficFlow>(), usage = new Map<string, UsageSample>(), recent = new Map<string, { observed: boolean; delivered: boolean }>();
  let startedAt = now(), sequence = 0, dropped = 0, pending: StatisticsBatch | null = null;
  function record(events: readonly ReceivedEvent[], delivered: boolean): void {
    for (const event of events) {
      if (event.type !== 'm.room.message' || event.sender === self || isListenerNotice(event)) continue;
      const previous = recent.get(event.event_id) ?? { observed: false, delivered: false };
      if (delivered ? previous.delivered : previous.observed) continue;
      const messageType = typeof event.content.msgtype === 'string' ? event.content.msgtype.slice(0, 100) : 'unknown';
      const key = JSON.stringify([event.room_id, event.sender, messageType]);
      let flow = flows.get(key);
      if (!flow && flows.size >= STATISTICS_LIMITS.flows) { dropped++; continue; }
      if (!flow) { flow = { roomId: event.room_id, senderMatrixId: event.sender, messageType, observed: 0, delivered: 0,
        contentBytes: 0, deliveredBytes: 0, attachmentBytes: 0, largestBytes: 0 }; flows.set(key, flow); }
      const bytes = event.content_file?.sourceBytes ?? Buffer.byteLength(JSON.stringify(event.content));
      if (!previous.observed) {
        flow.observed++; flow.contentBytes += bytes; flow.largestBytes = Math.max(flow.largestBytes, bytes);
        const info = event.content.info;
        const size = info && typeof info === 'object' && !Array.isArray(info) ? info.size : undefined;
        if (event.content_file) flow.attachmentBytes += event.content_file.attachmentBytes;
        else if (typeof size === 'number' && Number.isSafeInteger(size) && size >= 0) flow.attachmentBytes += size;
      }
      if (delivered) {
        flow.delivered++; flow.deliveredBytes += bytes;
      }
      recent.delete(event.event_id); recent.set(event.event_id, { observed: true, delivered: previous.delivered || delivered });
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
