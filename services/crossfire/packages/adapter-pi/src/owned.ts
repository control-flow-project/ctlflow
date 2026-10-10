import { join } from 'node:path';
import { mkdtempSync, rmSync, lstatSync } from 'node:fs';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { OwnedRuntimeAdapter } from '@ctlflow/crossfire-agent-core/owned-runtime';
import { profileName } from '@ctlflow/crossfire-contracts/client';
import { identifier } from '@ctlflow/crossfire-contracts/schema/validation';
import { errorCode } from '@ctlflow/crossfire-contracts/rest/envelope';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { archiveState } from '@ctlflow/crossfire-adapter-filesystem/archive';
import { readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { piOptions, configuredSettings } from './options.js';
import { piDirectories, piHome, refreshPiAuthentication } from './home.js';
import { piState, readPiBinding } from './state.js';
import { piHistories } from './histories.js';

function failed(error: unknown) {
  const code = errorCode(error && typeof error === 'object' && 'code' in error ? error.code : undefined);
  return failure(code.ok ? code.value : error instanceof SyntaxError ? 'invalid' : 'native', error instanceof Error ? error.message : 'Owned Pi operation failed');
}
export function piRuntime(binary = 'pi'): OwnedRuntimeAdapter {
  return { validate: piOptions, configuredSettings,
    async inspect(input, stop) {
      const parsed = piOptions(input.options); if (!parsed.ok) return parsed;
      let directory: string | undefined, histories: ReturnType<typeof piHistories> | undefined;
      try {
        piDirectories(input); stop.throwIfAborted();
        directory = mkdtempSync(join(input.stateDirectory, '.pi-inspection-'));
        const home = piHome(directory); refreshPiAuthentication(home);
        histories = piHistories({ ...input, stateDirectory: directory, profile: 'crossfire-inspection', name: 'crossfire-inspection',
          instructions: 'Capability inspection only. No model work is authorized.', options: parsed.value.options, allowNewHistory: true,
          hooks: { requestDecision: async () => failure('forbidden', 'Capability inspection cannot answer a native decision') } }, home, binary, stop);
        await histories.open('shared'); return success(undefined);
      } catch (error) { return failed(error); }
      finally { await histories?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); }
    },
    async savedContexts(input) {
      try {
        piDirectories(input);
        const home = piHome(input.stateDirectory), stored = piState(home);
        const contexts = stored.state.bindings.flatMap(binding => {
          readPiBinding(home, binding, input.workspace);
          return binding.sessionId ? [{ runtime: 'pi', workspace: input.workspace, context: binding.context, sessionId: binding.sessionId }] : [];
        });
        return success(contexts);
      } catch (error) { return failed(error); }
    },
    async reset(input) {
      if (!identifier(input.resetId).ok) return failure('invalid', 'Invalid Pi context reset identity');
      let release: (() => Promise<void>) | undefined;
      try {
        piDirectories(input); const home = piHome(input.stateDirectory); release = await acquireProcessLock(join(home, 'owner'));
        piState(home);
        const marker = join(home, 'crossfire-reset.json');
        if (lstatSync(marker, { throwIfNoEntry: false }) && readJson<{ resetId: string }>(marker).resetId === input.resetId) return success(undefined);
        archiveState(home, join(home, 'archive', input.resetId), name => ['crossfire-contexts.json', 'histories', 'receipts'].includes(name));
        writeJson(marker, { resetId: input.resetId }); return success(undefined);
      } catch (error) { return failed(error); }
      finally { await release?.(); }
    },
    async start(input, stop) {
      const parsed = piOptions(input.options); if (!parsed.ok) return parsed;
      if (!profileName(input.profile)) return failure('invalid', 'Native tools require the immutable controller-assigned profile');
      let release: (() => Promise<void>) | undefined, histories: ReturnType<typeof piHistories> | undefined;
      try {
        stop.throwIfAborted(); piDirectories(input);
        const home = piHome(input.stateDirectory); release = await acquireProcessLock(join(home, 'owner')); refreshPiAuthentication(home);
        histories = piHistories({ ...input, options: parsed.value.options }, home, binary, stop);
        const owner = histories, unlock = release;
        const primary = await owner.open(input.listenerOptions?.historyMode === 'per-room' ? 'control' : 'shared');
        return success({ ...primary, signal: owner.signal, attachment: null, attachments: async () => [], inspect: owner.inspect,
          ...(input.listenerOptions?.historyMode === 'per-room' ? { conversation: owner.open } : {}), settle: owner.settle, acknowledge: owner.acknowledge,
          turnControl: { activeTurn: owner.activeTurn, interrupt: owner.interrupt },
          close: async () => { try { await owner.close(); } finally { await unlock(); } } });
      } catch (error) { try { await histories?.close(); } finally { await release?.(); } return failed(error); }
    },
  };
}
