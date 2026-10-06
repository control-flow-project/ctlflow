import type { RuntimeHooks } from '@ctlflow/crossfire-agent-core/runtime';
import type { NativeEvent } from './protocol.js';
import { codexUsage } from './usage.js';
import { createHash, type Hash } from 'node:crypto';
import { observedEvent } from './observed-event.js';

export function nativeObservation(hooks: RuntimeHooks, session: () => string) {
  const streamed = new Map<string, { length: number; digest: Hash }>();
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
      const observed = observedEvent(event);
      if (!observed) return;
      if (observed.method === 'thread/status/changed') {
        const native = observed.status;
        state(native.type === 'idle' ? 'idle' : native.type !== 'active' ? 'unavailable'
          : native.activeFlags.includes('waitingOnApproval') ? 'waiting-approval'
          : native.activeFlags.includes('waitingOnUserInput') ? 'waiting-answer' : 'working');
      } else if (observed.method === 'turn/started') state('working');
      else if (observed.method === 'turn/completed') {
        state(observed.status === 'failed' ? 'failed' : 'idle', observed.errorMessage?.slice(0, 4000) ?? null);
        streamed.clear(); offsets.clear();
      } else if (observed.method === 'item/started') {
        const item = observed.item;
        if (item.type === 'commandExecution') output(item.id + ':command', JSON.stringify({ command: item.command, cwd: item.cwd }));
      } else if (observed.method === 'item/agentMessage/delta' || observed.method === 'item/commandExecution/outputDelta') {
        const current = streamed.get(observed.itemId) ?? { length: 0, digest: createHash('sha256') };
        current.length += observed.delta.length; current.digest.update(observed.delta, 'utf16le');
        streamed.set(observed.itemId, current);
        output(observed.itemId, observed.delta, observed.itemId);
      } else if (observed.method === 'item/mcpToolCall/progress') {
        output(observed.itemId, observed.message, observed.itemId);
      } else if (observed.method === 'item/completed') {
        const item = observed.item;
        const complete = item.type === 'agentMessage' ? item.text : item.type === 'commandExecution' ? item.aggregatedOutput : undefined;
        if (typeof complete === 'string') {
          const prefix = streamed.get(item.id);
          const matches = prefix && complete.length >= prefix.length
            && createHash('sha256').update(complete.slice(0, prefix.length), 'utf16le').digest('hex') === prefix.digest.digest('hex');
          output(item.id, matches ? complete.slice(prefix.length) : complete, item.id);
        }
        streamed.delete(item.id);
        if (item.type === 'fileChange') output(item.id, JSON.stringify(item.changes, null, 2));
        if (item.type === 'mcpToolCall') output(item.id, JSON.stringify({ tool: item.tool, result: item.result, error: item.error }));
        if (item.type === 'dynamicToolCall') output(item.id, JSON.stringify({ tool: item.tool, contentItems: item.contentItems, success: item.success }));
        if (item.type === 'webSearch') output(item.id, JSON.stringify({ tool: item.type, query: item.query, action: item.action, results: item.results }));
        if (item.type === 'imageGeneration') output(item.id, JSON.stringify({ tool: item.type, status: item.status, revisedPrompt: item.revisedPrompt, result: item.result, failure: item.failure }));
      }
    },
  };
}
