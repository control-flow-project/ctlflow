import { listen as receive, type ListenerOptions as CoreOptions } from '@ctlflow/crossfire-agent-core/listen';
import { localState } from '@ctlflow/crossfire-adapter-filesystem/state';
import { nativeClock } from '@ctlflow/crossfire-adapter-runtime/clock';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';
import { dirname, join } from 'node:path';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import type { ListenerHost } from './listener-host.js';
import { listenerStop } from '@ctlflow/crossfire-kernel/lifecycle';
export type ListenerOptions = Omit<CoreOptions, 'storage' | 'clock' | 'budget'> & { clock?: Clock; binding: string; host: ListenerHost };
export async function listen(options: ListenerOptions, signal: AbortSignal): Promise<void> {
  const release = await acquireProcessLock(join(dirname(options.cursorFile), 'receiver'));
  const stop = new AbortController(), lifetime = AbortSignal.any([stop.signal, signal]);
  let session = '';
  let endpoint: ReturnType<ListenerHost['bind']> | undefined;
  try {
    endpoint = options.host.bind({ cursorFile: options.cursorFile, release: options.release.release, binding: options.binding, session: () => session,
      stop: () => { stop.abort(listenerStop('Listener disconnected by its local control')); } });
    await receive({ ...options, budget: options.host.budget, runtime: async (...arguments_) => { const runtime = await options.runtime(...arguments_); session = runtime.sessionId; return runtime; },
    ready: (test, queries) => { endpoint!.ready(test, queries); options.ready?.(test, queries); },
    clock: options.clock ?? nativeClock, storage: localState }, lifetime); }
  catch (error) { lifetime.throwIfAborted(); throw error; }
  finally { try { endpoint?.close(); } finally { await release(); } }
}
