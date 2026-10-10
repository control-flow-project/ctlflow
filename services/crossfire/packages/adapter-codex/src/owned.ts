import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { OwnedRuntimeAdapter, OwnedRuntimeConnection, OwnedRuntimeInput } from '@ctlflow/crossfire-agent-core/owned-runtime';
import type { RuntimeAttachment } from '@ctlflow/crossfire-agent-core/terminal';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import { startProcess } from './owned-process.js';
import { nativeDirectories, prepareHome } from './home.js';
import { inspectCodex } from './prerequisites.js';
import { ownedOptions } from './owned-options.js';
import { codexHistories } from './histories.js';
import { resetCodex } from './reset.js';
import { errorCode } from '@ctlflow/crossfire-contracts/rest/envelope';
import { codexSavedContexts } from './context-state.js';
import { profileName } from '@ctlflow/crossfire-contracts/client';
import { refreshAuthentication } from './authentication.js';

type CodexAdapter = Omit<OwnedRuntimeAdapter, 'start'> & { start(input: OwnedRuntimeInput, stop: AbortSignal): Promise<Result<OwnedRuntimeConnection & { attachment: RuntimeAttachment }>> };
export function codexRuntime(binary = 'codex'): CodexAdapter {
  return { configuredSettings: options => ['model', 'model_reasoning_effort', 'sandbox_mode', 'approval_policy', 'dangerously_bypass_approvals_and_sandbox']
    .filter(name => options[name] !== undefined).map(name => ({ name, configured: String(options[name]), effective: null })),
    validate: ownedOptions, inspect: (input, stop) => inspectCodex(binary, input, stop), reset: resetCodex, savedContexts: codexSavedContexts, async start(input, stop) {
    const parsed = ownedOptions(input.options);
    if (!parsed.ok) return parsed;
    if (!profileName(input.profile)) return failure('invalid', 'Native tools require the immutable controller-assigned profile');
    let process: Awaited<ReturnType<typeof startProcess>> | undefined;
    let histories: ReturnType<typeof codexHistories> | undefined;
    try {
      stop.throwIfAborted();
      nativeDirectories(input);
      const home = prepareHome(input.stateDirectory);
      const authentication = refreshAuthentication(home);
      if (!authentication.ok) return authentication;
      process = await startProcess(home, input.workspace, input.stateDirectory, input.profile, stop, binary, parsed.value.options.features?.default_mode_request_user_input === true);
      const owner = process;
      const attachment = { runtime: 'codex', workspace: input.workspace,
        connection: { endpoint: owner.endpoint, tokenFile: owner.tokenFile, home, binary: owner.binary, path: owner.path } };
      histories = codexHistories({ home, workspace: input.workspace, name: input.name, instructions: input.instructions,
        config: parsed.value.options, hooks: { ...input.hooks, observe: event => input.hooks.observe?.(event.kind === 'state' && input.options.dangerously_bypass_approvals_and_sandbox !== undefined
          ? { ...event, observation: { ...event.observation, settings: [...event.observation.settings,
            { name: 'dangerously_bypass_approvals_and_sandbox', configured: String(input.options.dangerously_bypass_approvals_and_sandbox), effective: null }] } } : event) }, mode: input.listenerOptions?.historyMode ?? 'shared',
        endpoint: owner.endpoint, token: owner.token, attachment, allowNewHistory: input.allowNewHistory ?? false }, AbortSignal.any([stop, owner.signal]));
      const contexts = histories;
      const primary = await contexts.open(input.listenerOptions?.historyMode === 'per-room' ? 'control' : 'shared');
      return success({ ...primary, signal: contexts.signal, attachment: { ...attachment, sessionId: primary.sessionId },
        attachments: contexts.attachments, inspect: contexts.inspect,
        ...(input.listenerOptions?.historyMode === 'per-room' ? { conversation: contexts.open } : {}),
        settle: contexts.settle, acknowledge: contexts.acknowledge, turnControl: { activeTurn: contexts.activeTurn, interrupt: contexts.interrupt },
        close: async () => { try { await contexts.close(); } finally { await owner.close(); } } });
    } catch (error) { try { await histories?.close(); } finally { await process?.close(); }
      const code = errorCode(error && typeof error === 'object' && 'code' in error ? error.code : undefined);
      return failure(code.ok ? code.value : 'native', error instanceof Error ? error.message : 'Codex startup failed'); }
  } };
}
