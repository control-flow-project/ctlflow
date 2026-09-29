import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { HEARTBEAT_MS } from '@crossfire/contracts/activity';
import type { Manifest } from '@crossfire/contracts/release';
import type { Coordination } from './coordination.js';

export async function reportActivity(client: Coordination, agent: string, installed: Manifest, stop: AbortSignal) {
  const run = randomUUID();
  const failed = new AbortController(), lifetime = new AbortController();
  const signal = AbortSignal.any([stop, failed.signal, lifetime.signal]);
  let messages = 0, unavailable = false;
  let warnedRelease: string | undefined;
  async function report(stopped: boolean, initial = false): Promise<void> {
    const response = await client.report(agent, run, { release: installed.release, messagesDelivered: messages, stopped }, stopped ? undefined : signal);
    if (!response.ok) {
      if (initial) throw new Error(response.error.message);
      if (!stopped && ['invalid', 'unauthorized', 'forbidden', 'missing', 'conflict'].includes(response.error.code)) failed.abort(new Error(response.error.message));
      if (!signal.aborted && !unavailable) process.stderr.write('Crossfire heartbeat unavailable; management will show offline when it expires.\n');
      unavailable = true; return;
    }
    const current = response.value.currentRelease;
    if (!stopped && current !== installed.release && current !== warnedRelease) {
      warnedRelease = current;
      process.stderr.write('Crossfire release ' + current + ' is available. Reconnect to update the project client and skill; this listener remains running.\n');
    }
    unavailable = false;
    if (response.value.disconnect && !stopped) failed.abort(new Error('The owner requested this listener to disconnect'));
  }
  await report(false, true);
  const running = (async () => {
    while (!signal.aborted) {
      await delay(HEARTBEAT_MS, undefined, { signal });
      if (!signal.aborted) await report(false);
    }
  })().catch(error => { if (!signal.aborted) failed.abort(error); });
  let closing: Promise<void> | undefined;
  return {
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
