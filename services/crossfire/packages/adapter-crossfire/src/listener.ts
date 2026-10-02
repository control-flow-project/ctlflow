import { listen as receive, type ListenerOptions as CoreOptions } from '@crossfire/agent-core/listen';
import { matrix } from '@crossfire/adapter-matrix/http';
import { createInvitationReader } from '@crossfire/adapter-matrix/room/invitation';
import { localState } from '@crossfire/adapter-filesystem/state';
import { nativeClock } from '@crossfire/adapter-runtime/clock';
import type { Clock } from '@crossfire/agent-core/port';
export type ListenerOptions = Omit<CoreOptions, 'storage' | 'transport' | 'invitationRooms' | 'clock'> & { clock?: Clock };
export function listen(options: ListenerOptions, signal: AbortSignal): Promise<void> {
  const invitationState = createInvitationReader();
  return receive({ ...options, clock: options.clock ?? nativeClock, storage: localState, invitationRooms: async scope => {
    const pending = await invitationState({ base: options.settings.homeserver, token: options.account.access_token,
      signal: scope, timeoutMs: Math.min(45_000, options.reconcileMs) }, options.account.user_id);
    if (!pending.ok) throw Object.assign(new Error(pending.error.message), { code: pending.error.code });
    return [...pending.value.keys()];
  }, transport: (scope, timeoutMs) =>
    matrix({ base: options.settings.homeserver, token: options.account.access_token, signal: scope, timeoutMs }) }, signal);
}
