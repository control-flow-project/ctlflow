import { openSession, type SessionOptions } from '@ctlflow/crossfire-adapter-codex/session';
import { codexDelivery, type CodexConnection } from '@ctlflow/crossfire-adapter-codex/connection';
import type { RuntimeHooks } from '@ctlflow/crossfire-agent-core/runtime';

export async function resumeFixture(options: SessionOptions & { session: string; receiptFile: string; hooks: RuntimeHooks; pollMs?: number;
  config?: Record<string, unknown> }, stop: AbortSignal): Promise<CodexConnection> {
  let delivery: CodexConnection | undefined;
  const session = await openSession(options, { kind: 'resume', id: options.session, config: options.config ?? {} }, stop, options.hooks, event => delivery?.event(event));
  try {
    delivery = codexDelivery(session, { pollMs: options.pollMs ?? 100, timeoutMs: options.timeoutMs ?? 30000, receiptFile: options.receiptFile });
    await delivery.verify();
    return delivery;
  } catch (error) { if (delivery) await delivery.close(); else await session.close(); throw error; }
}
