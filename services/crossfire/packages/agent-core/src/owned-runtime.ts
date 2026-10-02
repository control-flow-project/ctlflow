import type { Result } from '@crossfire/kernel/result';
import type { RuntimeApproval, RuntimeConnection, RuntimeHooks, TurnControl } from './runtime.js';
import type { RuntimeAttachment } from './terminal.js';
export type OwnedRuntimeConnection = RuntimeConnection & { attachment: RuntimeAttachment; turnControl: TurnControl };
export type OwnedRuntimeInput = {
  name: string; workspace: string; instructions: string;
  options: Record<string, unknown>; hooks: RuntimeHooks;
};
export type OwnedRuntimeAdapter = {
  validate(options: unknown): Result<{ options: Record<string, unknown>; approval: RuntimeApproval }>;
  start(input: OwnedRuntimeInput, stop: AbortSignal): Promise<Result<OwnedRuntimeConnection>>;
};
