import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';

export function createFleetChanges() {
  const versions = new Map<string, number>(), waiting = new Map<string, () => void>();
  function version(fleetId: string): number { return versions.get(fleetId) ?? 0; }
  function notify(fleetId?: string): void {
    const keys = fleetId ? [fleetId] : [...waiting.keys()];
    for (const key of keys) { versions.set(key, version(key) + 1); waiting.get(key)?.(); }
    if (versions.size > 2048) for (const key of versions.keys()) if (!waiting.has(key)) { versions.delete(key); if (versions.size <= 1024) break; }
  }
  async function wait(fleetId: string, previous: number, milliseconds: number, signal: AbortSignal): Promise<Result<void>> {
    if (signal.aborted) return failure('unavailable', 'Controller request closed');
    if (version(fleetId) !== previous || milliseconds === 0) return success(undefined);
    if (waiting.has(fleetId)) return failure('conflict', 'This fleet already has a pending controller long poll');
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); waiting.delete(fleetId); resolve(); };
      const timer = setTimeout(finish, milliseconds);
      waiting.set(fleetId, finish);
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
    });
    return signal.aborted ? failure('unavailable', 'Controller request closed') : success(undefined);
  }
  return { version, notify, wait };
}
