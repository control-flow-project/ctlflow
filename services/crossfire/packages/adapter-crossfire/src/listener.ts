import { listen as receive, type ListenerOptions as CoreOptions } from '@crossfire/agent-core/listen';
import { matrix } from '@crossfire/adapter-matrix/http';
import { localState } from '@crossfire/adapter-filesystem/state';
export type ListenerOptions = Omit<CoreOptions, 'storage' | 'transport'>;
export function listen(options: ListenerOptions, signal: AbortSignal): Promise<void> {
  return receive({ ...options, storage: localState, transport: (scope, timeoutMs) =>
    matrix({ base: options.settings.homeserver, token: options.account.access_token, signal: scope, timeoutMs }) }, signal);
}
