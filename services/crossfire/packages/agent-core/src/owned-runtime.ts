import type { Result } from '@crossfire/kernel/result';
import type { RuntimeApproval, RuntimeConnection, RuntimeHooks, TurnControl } from './runtime.js';
import type { RuntimeAttachment } from './terminal.js';
import type { ListenerOptions } from '@crossfire/contracts/runtime';
export type OwnedRuntimeConnection = RuntimeConnection & { attachment: RuntimeAttachment; turnControl: TurnControl;
  attachments: () => Promise<{ context: string; attachment: RuntimeAttachment }[]> };
export type OwnedRuntimeInput = {
  name: string; workspace: string; instructions: string;
  options: Record<string, unknown>; hooks: RuntimeHooks;
  listenerOptions?: ListenerOptions;
};
export type OwnedRuntimeAdapter = {
  validate(options: unknown): Result<{ options: Record<string, unknown>; approval: RuntimeApproval }>;
  reset(input: { workspace: string; resetId: string }): Promise<Result<void>>;
  start(input: OwnedRuntimeInput, stop: AbortSignal): Promise<Result<OwnedRuntimeConnection>>;
};
