export type ListenerWork = 'acquisition' | 'publication' | 'native-start';
export type ListenerBudget = { acquire(kind: ListenerWork, signal: AbortSignal): Promise<() => void> };
type Pending = { signal: AbortSignal; resolve(release: () => void): void; reject(reason: unknown): void; cancelled(): void };

export function createListenerBudget(): ListenerBudget {
  const limits = { acquisition: 16, publication: 8, 'native-start': 4 };
  const active = { acquisition: 0, publication: 0, 'native-start': 0 };
  const queues: Record<ListenerWork, Pending[]> = { acquisition: [], publication: [], 'native-start': [] };
  function drain(kind: ListenerWork): void {
    while (active[kind] < limits[kind] && queues[kind].length) {
      const pending = queues[kind].shift()!;
      pending.signal.removeEventListener('abort', pending.cancelled);
      if (pending.signal.aborted) { pending.reject(pending.signal.reason); continue; }
      active[kind]++;
      let released = false;
      pending.resolve(() => { if (released) return; released = true; active[kind]--; drain(kind); });
    }
  }
  return { acquire(kind, signal) {
    signal.throwIfAborted();
    if (queues[kind].length >= 10000) return Promise.reject(new Error('Listener host work queue capacity reached'));
    return new Promise<() => void>((resolve, reject) => {
      const pending: Pending = { signal, resolve, reject, cancelled: () => {
        const index = queues[kind].indexOf(pending);
        if (index >= 0) queues[kind].splice(index, 1);
        signal.removeEventListener('abort', pending.cancelled);
        reject(signal.reason);
      } };
      queues[kind].push(pending); signal.addEventListener('abort', pending.cancelled, { once: true }); drain(kind);
    });
  } };
}
