import type { Json } from '@ctlflow/crossfire-kernel/json';
import type { BackendAccount, BackendConfiguration } from './messaging.js';
import type { Arguments } from '@ctlflow/crossfire-kernel/arguments';

export type MessagingToolContext = { configuration: BackendConfiguration; account: BackendAccount; instance: string; owner: string;
  server: string; maxUploadBytes: number; stateDirectory: string; lock(): Promise<() => Promise<void>> };
export type MessagingTools = { id: string; description: string; options: readonly string[];
  help(command?: string): Json;
  commandOptions(command: string): readonly string[];
  execute(context: MessagingToolContext, command: string, arguments_: Arguments): Promise<unknown>;
};
