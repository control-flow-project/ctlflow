import type { Result } from '@crossfire/kernel/result';

export type RuntimeAttachment = {
  runtime: string;
  sessionId: string;
  workspace: string;
  connection: Record<string, string>;
};

export type RuntimeTerminalAdapter = {
  command(attachment: RuntimeAttachment): Result<string>;
};
