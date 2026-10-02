export type TurnControl = {
  activeTurn: () => Promise<string | null>;
  interrupt: (turnId: string, recovery?: boolean) => Promise<void>;
};

export type RuntimeConnection = {
  sessionId: string;
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
import type { Json } from '@crossfire/contracts/json';

export type Permission = {
  runtime: string;
  session: string;
  request: string;
  action: string;
  scope: Json;
  choices: { label: string; value: Json }[];
};

export type RuntimeHooks = {
  requestPermission: (permission: Permission, signal: AbortSignal) => Promise<Json>;
};
