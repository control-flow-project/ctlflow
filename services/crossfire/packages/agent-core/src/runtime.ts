import type { Json } from '@crossfire/contracts/json';
import type { Result } from '@crossfire/kernel/result';

export type RuntimeApproval = 'none' | 'runtime' | 'listener';

export type TurnControl = {
  activeTurn: () => Promise<string | null>;
  interrupt: (turnId: string, recovery?: boolean) => Promise<void>;
};

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
  close: () => void | Promise<void>;
};

export type RuntimeAdapter = (stop: AbortSignal, pollMs: number, hooks: RuntimeHooks) => Promise<RuntimeConnection>;
export type Permission = {
  runtime: string;
  session: string;
  request: string;
  action: string;
  scope: Json;
  choices: { label: string; value: Json }[];
};

export type RuntimeHooks = {
  requestPermission: (permission: Permission, signal: AbortSignal) => Promise<Result<Json>>;
};
