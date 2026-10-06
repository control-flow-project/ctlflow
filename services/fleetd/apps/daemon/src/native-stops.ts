import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';
import type { ControllerBinding } from '@ctlflow/crossfire-agent-core/listener-control-port';

export type NativeStopActivity = { agentId: string; runId: string; binding: ControllerBinding; current(): ControllerBinding };
export type NativeStopReceipt = { agentId: string; runId: string; receiptId: string; binding: ControllerBinding };
type Entry = { activity: NativeStopActivity; receipt?: NativeStopReceipt; confirmed: boolean; error: string | null; sending?: Promise<Result<void>> };

export function createNativeStopReceipts(options: { clock: Clock; signal: AbortSignal; id(): string; connected(): boolean;
  send(receipt: NativeStopReceipt, signal: AbortSignal): Promise<Result<void>> }) {
  const entries = new Map<string, Entry>(), stop = new AbortController(), lifetime = AbortSignal.any([stop.signal, options.signal]);
  function current(entry: Entry): boolean {
    const selected = entry.activity.current(), captured = entry.activity.binding;
    return selected.fleetId === captured.fleetId && selected.connectionId === captured.connectionId && selected.credential === captured.credential;
  }
  function valid(entry: Entry): Result<void> {
    if (!entry.receipt) return failure('conflict', 'Native close is not confirmed for this authenticated listener run');
    if (!current(entry)) {
      return failure('conflict', 'Native stop proof belongs to an expired controller generation; resume and stop the current binding before retirement');
    }
    if (lifetime.aborted || !options.connected()) return failure('unavailable', 'Native process closed; its stop receipt is waiting for the original controller connection');
    return success(undefined);
  }
  async function confirm(agentId: string): Promise<Result<void>> {
    const entry = entries.get(agentId);
    if (!entry) return success(undefined);
    const checked = valid(entry);
    if (!checked.ok) { entry.error = checked.error.message; return checked; }
    if (entry.confirmed) return success(undefined);
    const pending = entry.sending ??= (async () => {
      try {
        const result = await options.send(entry.receipt!, lifetime);
        if (entries.get(agentId) !== entry) return failure('conflict', 'New authenticated activity invalidated this native stop receipt');
        if (!result.ok) { entry.error = result.error.message; return result; }
        const checked = valid(entry); if (!checked.ok) { entry.error = checked.error.message; return checked; }
        entry.confirmed = true; entry.error = null; return success(undefined);
      } catch (error) {
        entry.error = error instanceof Error ? error.message : 'Native stop receipt could not be recorded';
        return failure('unavailable', entry.error);
      }
    })();
    try { return await pending; }
    finally { if (entry.sending === pending) delete entry.sending; }
  }
  const running = (async () => {
    while (!lifetime.aborted) {
      const pending = [...entries.values()].filter(entry => entry.receipt && !entry.confirmed && current(entry));
      let position = 0;
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
        for (;;) {
          const entry = pending[position++]; if (!entry || lifetime.aborted) return;
          if (entries.get(entry.activity.agentId) === entry) await confirm(entry.activity.agentId);
        }
      }));
      await options.clock.delay(1000, lifetime);
    }
  })().catch(error => {
    if (!lifetime.aborted) for (const entry of entries.values()) if (entry.receipt && !entry.confirmed) entry.error = error instanceof Error ? error.message : 'Native stop receipt worker failed';
  });
  return {
    activity(agentId: string, runId: string, binding: ControllerBinding, current: () => ControllerBinding): NativeStopActivity {
      if (!entries.has(agentId) && entries.size >= 100) throw new Error('Native stop receipts exceed the configured fleet roster bound');
      const activity = { agentId, runId, binding: { ...binding }, current };
      entries.set(agentId, { activity, confirmed: false, error: null }); return activity;
    },
    closed(activity: NativeStopActivity): void {
      const entry = entries.get(activity.agentId);
      if (!entry || entry.activity !== activity || entry.receipt) return;
      entry.receipt = { agentId: activity.agentId, runId: activity.runId, receiptId: options.id(), binding: { ...activity.binding } };
      entry.error = 'Native process closed; its stop receipt is awaiting Crossfire acknowledgment';
    },
    confirm,
    forget(agentId: string) { entries.delete(agentId); },
    error: () => [...entries.values()].find(entry => entry.receipt && entry.error && current(entry))?.error ?? null,
    async close() { stop.abort(); await running; },
  };
}
