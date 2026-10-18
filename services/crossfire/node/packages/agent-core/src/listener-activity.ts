import { canRecoverFailure } from '@ctlflow/crossfire-kernel/lifecycle';
import type { Manifest } from '@ctlflow/crossfire-contracts/release';
import type { Clock } from './port.js';
import type { Coordination } from './coordination.js';
import type { ControllerBinding, ListenerControl } from './listener-control-port.js';
import type { listenerStatistics } from './statistics.js';
import { reportActivity } from './activity.js';

export function createListenerActivity(options: { client: Coordination; agentId: string; release: Manifest; control: ListenerControl;
  log(message: string): void;
  clock: Clock; statistics: ReturnType<typeof listenerStatistics>; updated(release: string): void;
  started(runId: string, binding: ControllerBinding): void; failed(error: unknown): void }, signal: AbortSignal) {
  let current: { generation: AbortSignal; reporter: Awaited<ReturnType<typeof reportActivity>> } | undefined;
  const observers = new Set<() => void>();
  const changed = () => { for (const observer of [...observers]) observer(); };
  function runId(): string | undefined {
    const control = options.control.current();
    return control.connected && current?.generation === control.connection && !current.reporter.signal.aborted ? current.reporter.runId : undefined;
  }
  async function ready(cancelled: AbortSignal): Promise<string> {
    const waiting = AbortSignal.any([signal, cancelled]);
    for (;;) {
      waiting.throwIfAborted(); const current = runId(); if (current) return current;
      await new Promise<void>(resolve => {
        const finish = () => { observers.delete(finish); unsubscribe(); waiting.removeEventListener('abort', finish); resolve(); };
        const unsubscribe = options.control.subscribe(finish); observers.add(finish);
        waiting.addEventListener('abort', finish, { once: true });
        if (runId() || waiting.aborted) finish();
      });
    }
  }
  async function pause(): Promise<void> {
    const previous = current; current = undefined;
    changed();
    await previous?.reporter.close();
  }
  async function activate(): Promise<boolean> {
    const generation = options.control.current().connection;
    if (current?.generation === generation) return true;
    await pause();
    signal.throwIfAborted();
    if (generation.aborted || !options.control.current().connected) return false;
    const binding = { ...options.control.binding() };
    let reporter: Awaited<ReturnType<typeof reportActivity>>;
    try {
      reporter = await reportActivity(options.client, options.agentId, options.release, AbortSignal.any([signal, generation]),
        binding, options.clock, options.statistics, options.log, options.updated);
    } catch (error) {
      signal.throwIfAborted();
      if (generation.aborted) return false;
      if (!canRecoverFailure(error)) throw error;
      options.control.unavailable(error instanceof Error ? error.message : 'Listener activity unavailable'); return false;
    }
    current = { generation, reporter };
    changed();
    const failed = () => {
      if (current?.reporter !== reporter || generation.aborted || signal.aborted) return;
      if (canRecoverFailure(reporter.signal.reason)) options.control.unavailable(reporter.signal.reason instanceof Error ? reporter.signal.reason.message : 'Listener activity unavailable');
      else options.failed(reporter.signal.reason);
    };
    reporter.signal.addEventListener('abort', failed, { once: true });
    options.started(reporter.runId, binding);
    if (reporter.signal.aborted) failed();
    return !generation.aborted && options.control.current().connected;
  }
  return { activate, pause, close: pause, runId, ready,
    delivered: (count: number) => current?.reporter.delivered(count) };
}
