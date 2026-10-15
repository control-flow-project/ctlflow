import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Registry } from './port.js';
import type { Instance, Registration, ResumeSelection } from './model.js';

export function createResumeSelections(registry: Registry, records: Registration[]) {
  const loaded = registry.resumeSelections();
  if (!loaded.ok) return loaded;
  if (loaded.value.some(item => !records.some(record => record.fleetId === item.fleetId))) return failure('invalid', 'Saved resume selection references an unregistered fleet');
  let saved = new Map(loaded.value.map(item => [item.fleetId, item.instanceKeys]));
  function persist(next: Map<string, string[]>): Result<void> {
    const values: ResumeSelection[] = [...next].map(([fleetId, instanceKeys]) => ({ fleetId, instanceKeys }));
    const stored = registry.saveResumeSelections(values);
    if (stored.ok) saved = next;
    return stored;
  }
  return success({
    view: (fleetId: string): string[] | null => saved.has(fleetId) ? [...saved.get(fleetId)!] : null,
    select(fleetId: string, catalog: Instance[], enabled: string[]): Result<Instance[]> {
      const paused = saved.get(fleetId);
      if (!paused && !enabled.length) return success(catalog);
      const selected = new Set([...(paused ?? []), ...enabled]);
      if ([...selected].some(instanceKey => !catalog.some(instance => instance.key === instanceKey))) return failure('conflict', 'A saved resume target is missing from the current roster; review the fleet');
      return success(catalog.filter(instance => selected.has(instance.key)));
    },
    stop(fleetId: string, enabled: string[], instanceKey?: string): Result<void> {
      const previous = saved.get(fleetId);
      if (instanceKey === undefined && !enabled.length && previous) return success(undefined);
      const next = new Map(saved);
      next.set(fleetId, instanceKey === undefined ? [...enabled].sort() : [...new Set([...(previous ?? []), ...enabled])].filter(item => item !== instanceKey).sort());
      return persist(next);
    },
    forget(fleetId: string, instanceKey?: string): Result<void> {
      if (!saved.has(fleetId)) return success(undefined);
      const next = new Map(saved);
      if (instanceKey === undefined) next.delete(fleetId);
      else next.set(fleetId, next.get(fleetId)!.filter(item => item !== instanceKey));
      return persist(next);
    },
  });
}
