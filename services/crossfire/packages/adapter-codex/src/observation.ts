import type { RuntimeHooks } from '@crossfire/agent-core/runtime';
import type { NativeEvent } from './protocol.js';
import { codexUsage } from './usage.js';

export function nativeObservation(hooks: RuntimeHooks, session: () => string) {
  const streamed = new Map<string, string>();
  const offsets = new Map<string, number>();
  let settings: { name: string; configured: string | null; effective: string | null }[] = [];
  function state(value: 'idle' | 'working' | 'waiting-approval' | 'waiting-answer' | 'failed' | 'unavailable', errorMessage: string | null = null): void {
    hooks.observe?.({ kind: 'state', observation: { runtime: 'codex', sessionId: session(), roomId: null, state: value, observedAt: Date.now(), settings, errorMessage } });
  }
  function output(id: string, text: string, streamId: string | null = null): void {
    if (!text) return;
    const offset = offsets.get(id) ?? 0;
    offsets.set(id, offset + Buffer.byteLength(text));
    hooks.observe?.({ kind: 'output', sessionId: session(), id: id + ':' + offset, streamId, text });
  }
  return {
    configure(configured: Record<string, unknown>, selected: Record<string, unknown>, version: string | null) {
      const sandbox = selected.sandbox && typeof selected.sandbox === 'object' ? (selected.sandbox as Record<string, unknown>).type : undefined;
      const values = { model: selected.model, model_reasoning_effort: selected.reasoningEffort, sandbox_mode: sandbox,
        approval_policy: selected.approvalPolicy, native_version: version };
      settings = Object.entries(values).map(([name, value]) => ({ name, configured: configured[name] === undefined ? null : String(configured[name]),
        effective: value === undefined || value === null ? null : String(value) }));
      for (const [name, value] of Object.entries(configured.features && typeof configured.features === 'object' ? configured.features : {})) settings.push({ name: 'features.' + name, configured: String(value), effective: null });
    }, state,
    event(event: NativeEvent): void {
      const params = event.params;
      if (params.threadId !== session()) return;
      const usage = codexUsage(event, session());
      if (usage) hooks.usage?.(usage);
      if (event.method === 'thread/status/changed') {
        const native = params.status && typeof params.status === 'object' ? params.status as Record<string, unknown> : {};
        const flags = Array.isArray(native.activeFlags) ? native.activeFlags : [];
        state(native.type === 'idle' ? 'idle' : flags.includes('waitingOnApproval') ? 'waiting-approval' : flags.includes('waitingOnUserInput') ? 'waiting-answer' : native.type === 'active' ? 'working' : 'unavailable');
      } else if (event.method === 'turn/started') state('working');
      else if (event.method === 'turn/completed') {
        const turn = params.turn && typeof params.turn === 'object' ? params.turn as Record<string, unknown> : {};
        const error = turn.error && typeof turn.error === 'object' ? turn.error as Record<string, unknown> : {};
        state(turn.status === 'failed' ? 'failed' : 'idle', typeof error.message === 'string' ? error.message.slice(0, 4000) : null);
        streamed.clear(); offsets.clear();
      } else if (event.method === 'item/started' && params.item && typeof params.item === 'object') {
        const item = params.item as Record<string, unknown>;
        if (item.type === 'commandExecution' && typeof item.id === 'string') output(item.id + ':command', JSON.stringify({ command: item.command, cwd: item.cwd }));
      } else if (['item/agentMessage/delta', 'item/commandExecution/outputDelta', 'item/mcpToolCall/progress', 'item/dynamicToolCall/progress'].includes(event.method)) {
        const value = params.delta ?? params.message;
        if (typeof params.itemId === 'string' && typeof value === 'string') {
          if (event.method === 'item/agentMessage/delta' || event.method === 'item/commandExecution/outputDelta') {
            streamed.set(params.itemId, (streamed.get(params.itemId) ?? '') + value);
          }
          output(params.itemId, value, params.itemId);
        }
      } else if (event.method === 'item/completed' && params.item && typeof params.item === 'object') {
        const item = params.item as Record<string, unknown>;
        if (typeof item.id !== 'string') return;
        const complete = item.type === 'agentMessage' ? item.text : item.type === 'commandExecution' ? item.aggregatedOutput : undefined;
        if (typeof complete === 'string') {
          const observed = streamed.get(item.id) ?? '';
          output(item.id, complete.startsWith(observed) ? complete.slice(observed.length) : complete, item.id);
        }
        streamed.delete(item.id);
        if (item.type === 'fileChange') output(item.id, JSON.stringify(item.changes, null, 2));
        if (['mcpToolCall', 'dynamicToolCall', 'webSearch', 'imageGeneration'].includes(String(item.type))) {
          output(item.id, JSON.stringify({ tool: item.tool ?? item.type, result: item.result ?? item.content ?? item.action ?? null, error: item.error ?? null }));
        }
      }
    },
  };
}
