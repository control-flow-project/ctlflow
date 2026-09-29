import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { HEARTBEAT_MS } from '../../contracts/src/activity.js';
import { fields } from '../../contracts/src/management.js';
import { nativeRequest, type Native } from '../../matrix/src/http.js';
import { manifest, updateNotice, type Manifest } from '../../contracts/src/release.js';

export async function reportActivity(client: Native, agent: string, installed: Manifest, stop: AbortSignal) {
  const run = randomUUID();
  const failed = new AbortController();
  const lifetime = new AbortController();
  const signal = AbortSignal.any([stop, failed.signal, lifetime.signal]);
  let messages = 0;
  let unavailable = false;
  let warnedRelease: string | undefined;
  async function report(stopped: boolean, initial = false): Promise<void> {
    const response = await nativeRequest({ base: client.base, ...(client.token ? { token: client.token } : {}),
      timeoutMs: 5000, ...(!stopped ? { signal } : {}) }, 'POST', '/_coord/agents/' + agent + '/heartbeat', { run, release: installed.release, messages, stopped });
    if (!response.ok || response.value.status >= 300) {
      const detail = response.ok ? response.value.body.error : undefined;
      const message = detail && typeof detail === 'object' && !Array.isArray(detail) && typeof detail.message === 'string'
        ? detail.message : response.ok ? 'Listener reporting rejected: HTTP ' + response.value.status : response.error.message;
      if (initial) throw new Error(message);
      if (!stopped && response.ok && [400, 401, 403, 404, 409].includes(response.value.status)) failed.abort(new Error(message));
      if (!signal.aborted && !unavailable) process.stderr.write('Crossfire heartbeat unavailable; management will show offline when it expires.\n');
      unavailable = true;
      return;
    }
    const parsed = fields(response.value.body, ['disconnect', 'current']);
    if (!parsed.ok || typeof parsed.value.disconnect !== 'boolean') {
      failed.abort(new Error('Invalid Crossfire heartbeat response')); return;
    }
    const current = manifest(parsed.value.current);
    if (!current.ok) { failed.abort(new Error('Invalid Crossfire release in heartbeat')); return; }
    if (!stopped && current.value.release !== installed.release && current.value.release !== warnedRelease) {
      warnedRelease = current.value.release;
      process.stderr.write('A Crossfire update is available for the next connection. This listener remains running.\n'
        + updateNotice(client.base, installed.release, current.value, installed.artifacts['SKILL.md'].sha256) + '\n');
    }
    unavailable = false;
    if (parsed.value.disconnect && !stopped) failed.abort(new Error('The owner requested this listener to disconnect'));
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
