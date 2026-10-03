import { failure, success } from '@crossfire/kernel/result';
import type { OwnedRuntimeAdapter } from '@crossfire/agent-core/owned-runtime';
import { startProcess } from './owned-process.js';
import { prepareHome } from './home.js';
import { ownedOptions } from './owned-options.js';
import { codexHistories } from './histories.js';
import { resetCodex } from './reset.js';

export function codexRuntime(binary = 'codex'): OwnedRuntimeAdapter {
  return { validate: ownedOptions, reset: resetCodex, async start(input, stop) {
    const parsed = ownedOptions(input.options);
    if (!parsed.ok) return parsed;
    let process: Awaited<ReturnType<typeof startProcess>> | undefined;
    let histories: ReturnType<typeof codexHistories> | undefined;
    try {
      const home = prepareHome(input.workspace);
      process = await startProcess(home, input.workspace, stop, binary, parsed.value.options.features?.default_mode_request_user_input === true);
      const owner = process;
      const attachment = { runtime: 'codex', workspace: input.workspace,
        connection: { endpoint: owner.endpoint, tokenFile: owner.tokenFile, home, binary: owner.binary, path: owner.path } };
      histories = codexHistories({ home, workspace: input.workspace, name: input.name, instructions: input.instructions,
        config: parsed.value.options, hooks: { ...input.hooks, observe: event => input.hooks.observe?.(event.kind === 'state' && input.options.dangerously_bypass_approvals_and_sandbox !== undefined
          ? { ...event, observation: { ...event.observation, settings: [...event.observation.settings,
            { name: 'dangerously_bypass_approvals_and_sandbox', configured: String(input.options.dangerously_bypass_approvals_and_sandbox), effective: null }] } } : event) }, mode: input.listenerOptions?.history_mode ?? 'shared',
        endpoint: owner.endpoint, token: owner.token, attachment }, AbortSignal.any([stop, owner.signal]));
      const contexts = histories;
      const primary = await contexts.open(input.listenerOptions?.history_mode === 'per-room' ? 'control' : 'shared');
      return success({ ...primary, signal: contexts.signal, attachment: { ...attachment, sessionId: primary.sessionId },
        attachments: contexts.attachments,
        ...(input.listenerOptions?.history_mode === 'per-room' ? { conversation: (room: string) => contexts.open(room) } : {}),
        settle: contexts.settle, acknowledge: contexts.acknowledge, turnControl: { activeTurn: contexts.activeTurn, interrupt: contexts.interrupt },
        close: async () => { await contexts.close(); await owner.close(); } });
    } catch (error) { await histories?.close(); await process?.close(); return failure('native', error instanceof Error ? error.message : 'Codex startup failed'); }
  } };
}
