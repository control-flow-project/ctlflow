import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { RuntimeApproval, RuntimeConnection, RuntimeHooks, TurnControl } from './runtime.js';
import type { RuntimeAttachment } from './terminal.js';
export type ListenerOptions = { historyMode?: 'shared' | 'per-room' };
export type SavedRuntimeContext = { context: string; runtime: string; sessionId: string; workspace: string };
export type OwnedRuntimeConnection = RuntimeConnection & { attachment: RuntimeAttachment; turnControl: TurnControl;
  attachments: () => Promise<{ context: string; attachment: RuntimeAttachment }[]> };
export type OwnedRuntimeInput = {
  name: string; workspace: string; instructions: string;
  options: Record<string, unknown>; hooks: RuntimeHooks;
  listenerOptions?: ListenerOptions;
  allowNewHistory?: boolean;
};
export type OwnedRuntimeAdapter = {
  validate(options: unknown): Result<{ options: Record<string, unknown>; approval: RuntimeApproval }>;
  savedContexts(input: { workspace: string }): Promise<Result<SavedRuntimeContext[]>>;
  reset(input: { workspace: string; resetId: string }): Promise<Result<void>>;
  start(input: OwnedRuntimeInput, stop: AbortSignal): Promise<Result<OwnedRuntimeConnection>>;
};
