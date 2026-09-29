import { realpathSync } from 'node:fs';
import type { Json } from '../../contracts/src/json.js';
import type { RuntimeHooks } from '../../agent-core/src/runtime.js';
import { codexPermission } from './approval.js';
import { object } from '../../contracts/src/management.js';
import { codexProtocol, type NativeEvent } from './protocol.js';

export type CodexOptions = {
  workspace: string; session: string; endpoint: string; token: string;
  timeoutMs?: number; pollMs?: number;
};
export type CodexSession = {
  sessionId: string; workspace: string; signal: AbortSignal;
  request: (method: string, params: unknown) => Promise<unknown>;
  close: () => Promise<void>;
};

export async function connectSession(options: CodexOptions, stop: AbortSignal, hooks: RuntimeHooks,
  event: (event: NativeEvent) => void): Promise<CodexSession> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(options.session)) throw new Error('Supply the exact loaded Codex session UUID');
  const workspace = realpathSync(options.workspace);
  const changes = new Map<string, Json>();
  const engine = codexProtocol({ endpoint: options.endpoint, token: options.token, timeoutMs: options.timeoutMs ?? 30_000,
    event: notice => {
      if (notice.params.threadId === options.session && ['item/started', 'item/completed'].includes(notice.method)) {
        const item = notice.params.item;
        if (item && typeof item === 'object' && 'type' in item && item.type === 'fileChange' && 'id' in item && 'changes' in item) {
          if (typeof item.id !== 'string' || !item.id) throw new Error('Invalid pending native file identity');
          if (notice.method === 'item/completed') changes.delete(item.id);
          else {
            if (changes.size >= 16 || Buffer.byteLength(JSON.stringify(item.changes)) > 12_000) throw new Error('Pending file approval exceeds its scope bound');
            changes.set(item.id, structuredClone(item.changes) as Json);
          }
        }
      }
      event(notice);
    },
    approval: async (request, signal) => {
      const decoded = codexPermission(request, options.session, changes.get(String(request.params.itemId)));
      if (!decoded.ok) throw new Error(decoded.error.message);
      return hooks.requestPermission(decoded.value, signal);
    },
  }, stop);
  async function close(): Promise<void> { engine.close(); await engine.closed; }
  try {
    await engine.request('initialize', { clientInfo: { name: 'crossfire', title: 'Crossfire listener', version: '0.1.0' },
      capabilities: { experimentalApi: true } });
    engine.notify('initialized');
    const read = object(await engine.request('thread/read', { threadId: options.session, includeTurns: false }));
    const thread = read.ok ? object(read.value.thread) : read;
    const state = thread.ok ? object(thread.value.status) : thread;
    if (!thread.ok || !state.ok || thread.value.id !== options.session || thread.value.canAcceptDirectInput !== true
      || !['idle', 'active'].includes(String(state.value.type)) || typeof thread.value.cwd !== 'string'
      || realpathSync(thread.value.cwd) !== workspace) throw new Error('The selected Codex session must be loaded in this exact workspace');
    await engine.request('thread/resume', { threadId: options.session, excludeTurns: true });
    return { sessionId: options.session, workspace, signal: engine.signal, request: engine.request, close };
  } catch (error) { await close(); throw error; }
}
