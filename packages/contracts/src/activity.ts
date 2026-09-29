import { failure, success, type Result } from './result.js';
import { releaseName } from './release.js';

export const HEARTBEAT_MS = 30_000;
export const LISTENER_EXPIRY_MS = 90_000;
export const ACTIVITY_REFRESH_MS = 5000;
export type ListenerView = { id: string; release: string | null; started: number; lastSeen: number; disconnectRequested: boolean };
export type ActivityView = {
  status: 'online' | 'offline' | 'disconnecting';
  listeners: number;
  lastSeen: number | null;
  activeMs: number;
  messages: number;
  lastRelease: string | null;
  runs: ListenerView[];
};

export function emptyActivity(): ActivityView {
  return { status: 'offline', listeners: 0, lastSeen: null, activeMs: 0, messages: 0, lastRelease: null, runs: [] };
}

export function parseActivity(value: unknown): Result<ActivityView> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failure('invalid', 'Invalid listener activity');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'activeMs,lastRelease,lastSeen,listeners,messages,runs,status'
    || !['online', 'offline', 'disconnecting'].includes(String(data.status))
    || !['listeners', 'activeMs', 'messages'].every(key => Number.isSafeInteger(data[key]) && Number(data[key]) >= 0)
    || data.lastSeen !== null && (!Number.isSafeInteger(data.lastSeen) || Number(data.lastSeen) < 0)
    || data.lastRelease !== null && !releaseName(data.lastRelease)
    || !Array.isArray(data.runs) || data.runs.length > 100 || data.runs.length !== data.listeners) return failure('invalid', 'Invalid listener activity');
  const identities = new Set<string>();
  for (const item of data.runs) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return failure('invalid', 'Invalid listener version');
    const run = item as Record<string, unknown>;
    if (Object.keys(run).sort().join(',') !== 'disconnectRequested,id,lastSeen,release,started'
      || typeof run.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(run.id)
      || identities.has(run.id) || run.release !== null && !releaseName(run.release)
      || typeof run.disconnectRequested !== 'boolean'
      || !['started', 'lastSeen'].every(key => Number.isSafeInteger(run[key]) && Number(run[key]) >= 0)) return failure('invalid', 'Invalid listener version');
    identities.add(run.id);
  }
  return success(data as ActivityView);
}
