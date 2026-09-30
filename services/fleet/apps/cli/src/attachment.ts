import type { RuntimeAttachment, RuntimeTerminalAdapter } from '@crossfire/agent-core/terminal';
import { createDaemonClient, operations } from '@fleet/daemon-client/client';
import { sshTerminalCommand } from '@fleet/ssh-transport/terminal';
import { failure, success, type Result } from '@crossfire/kernel/result';

export type TerminalPointer = Omit<RuntimeAttachment, 'connection'> & { command: string };

export async function terminalPointer(client: ReturnType<typeof createDaemonClient>, fleetId: string, instanceKey: string,
  adapters: Record<string, RuntimeTerminalAdapter>, host?: string): Promise<Result<TerminalPointer>> {
  const response = await client.call(operations.attachment, { fleetId, instanceKey }, {});
  if (!response.ok) return response;
  const attachment = response.value.data, adapter = Object.hasOwn(adapters, attachment.runtime) ? adapters[attachment.runtime] : undefined;
  if (!adapter) return failure('invalid', 'No terminal adapter for runtime: ' + attachment.runtime);
  try {
    const command = adapter.command(attachment);
    if (!command.ok) return command;
    return success({ runtime: attachment.runtime, sessionId: attachment.sessionId, workspace: attachment.workspace,
      command: host ? sshTerminalCommand(host, command.value) : command.value });
  } catch (error) { return failure('invalid', error instanceof Error ? error.message : 'Invalid terminal pointer'); }
}
