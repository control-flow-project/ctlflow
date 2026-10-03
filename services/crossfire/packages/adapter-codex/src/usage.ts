import { tokenCounts, type UsageSample } from '@crossfire/contracts/statistics';
import type { NativeEvent } from './protocol.js';

export function codexUsage(event: NativeEvent, sessionId: string): UsageSample | null {
  if (event.method !== 'thread/tokenUsage/updated' || event.params.threadId !== sessionId) return null;
  const usage = event.params.tokenUsage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage) || !('total' in usage)) return null;
  const total = usage.total;
  if (!total || typeof total !== 'object' || Array.isArray(total)) return null;
  const value = total as Record<string, unknown>;
  const parsed = tokenCounts({ input: value.inputTokens, cachedInput: value.cachedInputTokens,
    cacheWriteInput: value.cacheWriteInputTokens ?? null, output: value.outputTokens, reasoningOutput: value.reasoningOutputTokens, total: value.totalTokens });
  return parsed.ok ? { runtime: 'codex', sessionId, tokens: parsed.value } : null;
}
