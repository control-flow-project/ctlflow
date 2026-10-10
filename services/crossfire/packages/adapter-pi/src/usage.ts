import { tokenCounts, type TokenCounts } from '@ctlflow/crossfire-contracts/statistics';
import type { RuntimeHooks } from '@ctlflow/crossfire-agent-core/runtime';
import { record } from './protocol.js';

function counts(value: unknown): TokenCounts {
  const native = record(value);
  const result = tokenCounts({ input: Number(native.input) + Number(native.cacheRead) + Number(native.cacheWrite), cachedInput: native.cacheRead,
    cacheWriteInput: native.cacheWrite, output: native.output, reasoningOutput: null,
    total: Number(native.input) + Number(native.cacheRead) + Number(native.cacheWrite) + Number(native.output) });
  if (!result.ok || !Number.isSafeInteger(native.input) || Number(native.input) < 0) throw new Error('Invalid native Pi usage counters');
  return result.value;
}
export function piUsage(hooks: RuntimeHooks, session: () => string) {
  let tokens: TokenCounts | undefined;
  const report = () => { if (tokens) hooks.usage?.({ runtime: 'pi', sessionId: session(), tokens: { ...tokens } }); };
  return {
    initialize(value: unknown) {
      const native = record(value);
      if (native.sessionId !== session()) throw new Error('Pi usage belongs to another session');
      tokens = counts(native.tokens); report();
    },
    event(event: Record<string, unknown>) {
      if (!tokens || !['entry_appended', 'message_end'].includes(String(event.type))) return;
      const entry = event.type === 'entry_appended' ? record(event.entry) : {}, message = event.type === 'message_end' ? record(event.message) : undefined;
      const usage = message && ['assistant', 'toolResult'].includes(String(message.role)) ? message.usage
        : ['usage', 'compaction', 'branch_summary'].includes(String(entry.type)) ? entry.usage : undefined;
      if (!usage) return;
      const increment = counts(usage);
      const result = tokenCounts({ input: tokens.input + increment.input, cachedInput: tokens.cachedInput + increment.cachedInput,
        cacheWriteInput: tokens.cacheWriteInput! + increment.cacheWriteInput!, output: tokens.output + increment.output, reasoningOutput: null,
        total: tokens.total + increment.total });
      if (!result.ok) throw new Error('Pi usage counter overflow');
      tokens = result.value; report();
    },
  };
}
