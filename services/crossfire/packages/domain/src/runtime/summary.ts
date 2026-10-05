import type { NativeRuntimeSummary, RuntimeObservation } from './values.js';

const priority = ['failed', 'waiting-approval', 'waiting-answer', 'waking', 'working', 'unavailable', 'idle', 'sleeping'] as const;
export function summarizeNative(values: Pick<RuntimeObservation, 'state' | 'observedAt' | 'lastActivityAt' | 'historyAvailable'>[]): NativeRuntimeSummary | null {
  if (!values.length) return null;
  const state = priority.find(state => values.some(value => value.state === state))!;
  const activity = values.map(value => value.lastActivityAt).filter((value): value is number => value !== null);
  return { state, observedAt: Math.max(...values.map(value => value.observedAt)), lastActivityAt: activity.length ? Math.max(...activity) : null,
    historyAvailable: values.some(value => value.historyAvailable === false) ? false : values.every(value => value.historyAvailable === true) ? true : null };
}
