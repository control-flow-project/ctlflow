import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { RuntimeApproval, RuntimeConnection, RuntimeHooks, TurnControl } from './runtime.js';
import type { RuntimeAttachment } from './terminal.js';
import type { RuntimeObservation } from '@ctlflow/crossfire-contracts/runtime';
export type ListenerOptions = { historyMode?: 'shared' | 'per-room' };
export type SavedRuntimeContext = { context: string; runtime: string; sessionId: string; workspace: string };
export type NativeContextActivity = { context: string; sessionId: string; busy: boolean };
export type NativeActivity = { busy: boolean; contexts: NativeContextActivity[] };
export type ProviderState = 'present' | 'missing' | 'not-required' | 'unknown';
export type NativeDiagnostic = { checkedAt: number; state: RuntimeObservation['state'] | 'unknown'; observedAt: number | null;
  provider: ProviderState; providerObservedAt: number | null; pendingInput: boolean; pendingDecision: boolean };
export type OwnedRuntimeConnection = RuntimeConnection & { attachment: RuntimeAttachment | null; turnControl: TurnControl;
  provider: (signal: AbortSignal) => Promise<Result<ProviderState>>;
  activity: () => Promise<NativeActivity>;
  attachments: () => Promise<{ context: string; attachment: RuntimeAttachment }[]> };
export type OwnedRuntimeInput = {
  profile: string; name: string; workspace: string; stateDirectory: string; instructions: string;
  options: Record<string, unknown>; hooks: RuntimeHooks;
  listenerOptions?: ListenerOptions;
  allowNewHistory?: boolean;
};
export type OwnedRuntimeAdapter = {
  configuredSettings(options: Record<string, unknown>): RuntimeObservation['settings'];
  validate(options: unknown): Result<{ options: Record<string, unknown>; approval: RuntimeApproval }>;
  inspect(input: { workspace: string; stateDirectory: string; options: Record<string, unknown> }, stop: AbortSignal): Promise<Result<void>>;
  savedContexts(input: { workspace: string; stateDirectory: string }): Promise<Result<SavedRuntimeContext[]>>;
  reset(input: { workspace: string; stateDirectory: string; resetId: string }): Promise<Result<void>>;
  start(input: OwnedRuntimeInput, stop: AbortSignal): Promise<Result<OwnedRuntimeConnection>>;
};
