import { piHost } from './host.js';
import type { PiApi } from './native.js';

export function registerPi(api: PiApi, software: string): void {
  let host: Awaited<ReturnType<typeof piHost>> | undefined;
  const close = async () => { const previous = host; host = undefined; await previous?.close(); };
  api.on('session_start', async (_event, context) => { await close(); host = await piHost(api, context, software); });
  api.on('session_shutdown', close);
  api.on('session_before_tree', close);
  api.on('agent_start', () => host?.start());
  api.on('agent_end', () => host?.end());
  api.on('agent_settled', () => host?.settled());
}
