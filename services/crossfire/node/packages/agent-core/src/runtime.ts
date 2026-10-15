import type { Json } from '@ctlflow/crossfire-contracts/json';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { DecisionCreation, RuntimeObservation } from '@ctlflow/crossfire-contracts/runtime';
import type { UsageSample } from '@ctlflow/crossfire-contracts/statistics';

export type RuntimeApproval = 'none' | 'runtime' | 'listener';
export type InputPriority = 'steering';
export type InputAdmission = { priority: InputPriority; signal: AbortSignal };

export type TurnControl = {
  activeTurn: (room?: string, admission?: InputAdmission) => Promise<string | null>;
  interrupt: (turnId: string, recovery?: boolean, admission?: InputAdmission) => Promise<'interrupted' | 'inactive'>;
};
export type NativeSessionState = { phase: 'running' | 'sleeping' | 'waking' | 'failed'; lastActivityAt: number | null; historyAvailable: boolean };
export type RuntimeLifecycle = { current: () => NativeSessionState; configureIdle: (seconds: number) => void };

export type RuntimeConnection = {
  sessionId: string;
  approval: RuntimeApproval;
  signal: AbortSignal;
  inspect: () => Promise<{ busy: boolean }>;
  deliver: (text: string, messageId: string, cancelled?: AbortSignal, priority?: InputPriority) => Promise<void>;
  settle: (cancelled?: AbortSignal) => Promise<boolean>;
  recover: (text: string, messageId: string, cancelled?: AbortSignal) => Promise<boolean>;
  acknowledge: (messageIds: readonly string[]) => void;
  turnControl?: TurnControl;
  lifecycle?: RuntimeLifecycle;
  conversation?: (room: string, admission?: InputAdmission) => Promise<RuntimeConnection>;
  close: () => void | Promise<void>;
};

export type RuntimeAdapter = (stop: AbortSignal, pollMs: number, hooks: RuntimeHooks) => Promise<RuntimeConnection>;
export type RuntimeDecision = {
  runtime: string;
  session: string;
  request: string;
  action: string;
  scope: Json;
  choices: { label: string; value: Json }[];
  turn?: string;
  item?: string;
  blocking?: boolean;
  expiresMs?: number | null;
  questions?: DecisionCreation['questions'];
};

export type RuntimeObservationEvent = { kind: 'output'; sessionId: string; id: string; streamId: string | null; text: string }
  | { kind: 'state'; observation: Omit<RuntimeObservation, 'historyMode' | 'maxInputBytes' | 'lastActivityAt' | 'historyAvailable'> };

export type RuntimeHooks = {
  usage?: (sample: UsageSample) => void;
  requestDecision: (permission: RuntimeDecision, signal: AbortSignal) => Promise<Result<Json>>;
  decisionResponded?: (decision: RuntimeDecision) => void;
  pendingDecisions?: () => boolean;
  pendingInput?: () => boolean;
  observe?: (event: RuntimeObservationEvent) => void;
};
