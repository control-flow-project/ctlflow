import type { Json } from '@crossfire/contracts/json';
import type { Result } from '@crossfire/kernel/result';
import type { DecisionCreation, RuntimeObservation } from '@crossfire/contracts/runtime';
import type { UsageSample } from '@crossfire/contracts/statistics';

export type RuntimeApproval = 'none' | 'runtime' | 'listener';

export type TurnControl = {
  activeTurn: (room?: string) => Promise<string | null>;
  interrupt: (turnId: string, recovery?: boolean) => Promise<void>;
};
export type NativeSessionState = { phase: 'running' | 'sleeping' | 'waking' | 'failed'; lastActivityAt: number | null; historyAvailable: boolean };
export type RuntimeLifecycle = { current: () => NativeSessionState; configureIdle: (seconds: number) => void };

export type RuntimeConnection = {
  sessionId: string;
  approval: RuntimeApproval;
  signal: AbortSignal;
  inspect: () => Promise<{ busy: boolean }>;
  deliver: (text: string, messageId: string, cancelled?: AbortSignal) => Promise<void>;
  settle: () => Promise<boolean>;
  recover: (text: string, messageId: string) => Promise<boolean>;
  acknowledge: (messageIds: readonly string[]) => void;
  turnControl?: TurnControl;
  lifecycle?: RuntimeLifecycle;
  conversation?: (room: string) => Promise<RuntimeConnection>;
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
