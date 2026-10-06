import { randomUUID } from 'node:crypto';
import type { Clock } from './port.js';
import { HEARTBEAT_MS } from '@ctlflow/crossfire-contracts/activity';
import type { Manifest } from '@ctlflow/crossfire-contracts/release';
import type { Coordination } from './coordination.js';
import type { listenerStatistics } from './statistics.js';
import type { ControllerBinding } from './listener-control-port.js';

export async function reportActivity(client: Coordination, agent: string, installed: Manifest, stop: AbortSignal, controller: ControllerBinding, clock: Clock, statistics: ReturnType<typeof listenerStatistics>, onUpdate?: (release: string) => void) {
  const run = randomUUID();
  const failed = new AbortController(), lifetime = new AbortController();
  const signal = AbortSignal.any([stop, failed.signal, lifetime.signal]);
  let messages = 0, unavailable = false;
  let warnedRelease: string | undefined;
  async function report(stopped: boolean, initial = false): Promise<void> {
    const batch = statistics.batch(stopped);
    const response = await client.report(agent, run, { release: installed.release, messagesDelivered: messages, stopped, controller, statistics: batch }, stopped ? undefined : signal);
    if (!response.ok) {
      if (initial) throw Object.assign(new Error(response.error.message), { code: response.error.code });
      if (!stopped && ['invalid', 'unauthorized', 'forbidden', 'missing', 'conflict'].includes(response.error.code)) failed.abort(Object.assign(new Error(response.error.message), { code: response.error.code }));
      if (!signal.aborted && !unavailable) process.stderr.write('Crossfire heartbeat unavailable; management will show offline when it expires.\n');
      unavailable = true; return;
    }
    if (response.value.statisticsAccepted) statistics.acknowledge(batch);
    const current = response.value.currentRelease;
    if (!stopped) onUpdate?.(current);
    if (!stopped && current !== installed.release && current !== warnedRelease) {
      warnedRelease = current;
      process.stderr.write('Crossfire release ' + current + ' is available. Ask the owner to update the fleet controller and review changed skills; this listener remains running.\n');
    }
    unavailable = false;
    if (response.value.disconnect && !stopped) failed.abort(Object.assign(new Error('Listener admission expired; reconnect its controller lease'), { code: 'unavailable' }));
  }
  await report(false, true);
  const running = (async () => {
    while (!signal.aborted) {
      await clock.delay(HEARTBEAT_MS, signal);
      if (!signal.aborted) await report(false);
    }
  })().catch(error => { if (!signal.aborted) failed.abort(error); });
  let closing: Promise<void> | undefined;
  return {
    runId: run,
    signal: failed.signal,
    delivered(count: number): void {
      if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(messages + count)) throw new Error('Invalid delivered message count');
      messages += count;
    },
    close(): Promise<void> {
      closing ??= (async () => { lifetime.abort(); await running; await report(true); })();
      return closing;
    },
  };
}
