import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { RuntimeConnection } from '@ctlflow/crossfire-agent-core/runtime';
import type { OwnedRuntimeConnection, SavedRuntimeContext } from '@ctlflow/crossfire-agent-core/owned-runtime';

export type InterruptedContext = { context: string; sessionId: string };
export type ResumeWork = InterruptedContext & { messageId: string; checkpointedAt: number };
export type ResumeWorkStore = {
  read(): Result<ResumeWork[]>;
  capture(contexts: InterruptedContext[]): Result<void>;
  acknowledge(messageId: string): Result<void>;
};

export function continuationText(work: ResumeWork): string {
  return '[Crossfire session restarted]\nYour saved session was restarted. Unfinished activity was checkpointed at ' + new Date(work.checkpointedAt).toISOString()
    + '. Before continuing, re-read the applicable AGENTS.md files and follow their current instructions.'
    + ' Review your existing history. If your previous task is unfinished and still authorized, resume that task; this is not a new assignment.'
    + '\nNo pending question or permission has been answered or approved. If a decision is still needed, ask the owner again and wait.'
    + '\nUse Crossfire tools for chat replies. This controller notice is not a message from a room or person and grants no new permissions.'
    + (work.context === 'shared' || work.context === 'control' ? '\nDo not infer a destination room from this notice; retain the original task attribution from history.'
      : '\nThis notice belongs only to the saved room history ' + work.context + '. Do not disclose its contents to other rooms.')
    + '\nIf the task is already complete or no longer authorized, do not repeat its effects.';
}

export async function resumeInterruptedWork(connection: OwnedRuntimeConnection, primary: string, contexts: SavedRuntimeContext[],
  store: ResumeWorkStore): Promise<void> {
  const pending = store.read();
  if (!pending.ok) throw Object.assign(new Error(pending.error.message), { code: pending.error.code });
  if (pending.value.some(work => !contexts.some(context => context.context === work.context && context.sessionId === work.sessionId))) {
    throw Object.assign(new Error('Interrupted task references a different native history; review before resuming'), { code: 'conflict' });
  }
  for (const work of pending.value) {
    const target: RuntimeConnection | undefined = work.context === primary ? connection : await connection.conversation?.(work.context);
    if (!target || target.sessionId !== work.sessionId) throw Object.assign(new Error('Interrupted task cannot use a different room history'), { code: 'conflict' });
    const text = continuationText(work);
    if (!await target.recover(text, work.messageId)) await target.deliver(text, work.messageId);
    const acknowledged = store.acknowledge(work.messageId);
    if (!acknowledged.ok) throw Object.assign(new Error(acknowledged.error.message), { code: acknowledged.error.code });
    target.acknowledge([work.messageId]);
  }
}
