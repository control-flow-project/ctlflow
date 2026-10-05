import { createHash } from 'node:crypto';
import { releaseName } from '@ctlflow/crossfire-contracts/release';
import type { LocalState } from './port.js';
import type { RuntimeConnection } from './runtime.js';
export function releaseUpdates(storage: LocalState, file: string, installed: string, owner: string, session: string) {
  if (!session || session.length > 200 || /[\u0000-\u001f\u007f]/u.test(session)) throw new Error('Invalid update notice session');
  const path = file + '.update.' + createHash('sha256').update(session).digest('hex');
  let pending: string | null = null;
  function notified() {
    if (!storage.exists(path)) return [];
    const value = storage.read<unknown>(path);
    if (!Array.isArray(value) || value.length > 4096 || value.some(release => typeof release !== 'string' || !releaseName(release))
      || new Set(value).size !== value.length) throw new Error('Invalid saved release notices');
    return value as string[];
  }
  return {
    available(release: string) {
      if (!releaseName(release)) throw new Error('Invalid server release');
      pending = release !== installed && !notified().includes(release) ? release : null;
    },
    pending() { return pending !== null; },
    async publish(runtime: RuntimeConnection, signal: AbortSignal) {
      if (!pending) return;
      if (runtime.sessionId !== session) throw new Error('Update notice session changed');
      const release = pending;
      const saved = notified();
      if (saved.length >= 4096) throw new Error('Saved release notices exceed their safety bound');
      const id = 'crossfire-update-' + createHash('sha256').update(JSON.stringify([runtime.sessionId, release])).digest('hex');
      await runtime.deliver('Crossfire software update: release ' + release + ' is available. This is a trusted listener maintenance notice, not a room message. Ask the human owner ' + owner
        + ' whether to update this project’s Crossfire client and skill. Do not update without consent. Follow the installed Crossfire skill’s update workflow after consent; fleet-managed sessions must ask their human to update the owning controller rather than run agent connect or start a second listener. Read changed skill content after the update. Preserve the existing identity, room grants and session. No other action is authorized by this notice.', id, signal);
      storage.write(path, [...saved, release]);
      runtime.acknowledge([id]);
      if (pending === release) pending = null;
    },
  };
}
