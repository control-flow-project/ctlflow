import { realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readPrivateBytes } from '@ctlflow/crossfire-adapter-filesystem/index';
import { codexProtocol } from '@ctlflow/crossfire-adapter-codex/protocol';
import { ownedOptions } from '@ctlflow/crossfire-adapter-codex/owned-options';
import { admitCodex } from '@ctlflow/crossfire-adapter-codex/admission';
import { codexClientVersion } from '@ctlflow/crossfire-adapter-codex/version';
import { object } from '@ctlflow/crossfire-contracts/validation';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { fingerprint } from '@ctlflow/crossfire-operator-support/files';
import type { NativeInspector, NativePreserver } from './types.js';

export const preserveCodex: NativePreserver = workspace => {
  const path = join(workspace, '.codex', 'auth.json');
  if (!existsSync(path)) return success([]);
  const checked = fingerprint(path);
  return checked.ok ? success([{ path, ...checked.value }]) : checked;
};

export const inspectCodex: NativeInspector = async (input, signal) => {
  const settings = ownedOptions(input.options); if (!settings.ok) return settings;
  const { attachment } = input;
  const endpoint = attachment.connection.endpoint, tokenFile = attachment.connection.tokenFile;
  if (!endpoint || !tokenFile) return failure('invalid', 'The native attachment lacks its exact endpoint/private token-file pointer');
  let protocol: ReturnType<typeof codexProtocol> | undefined;
  try {
    const token = new TextDecoder('utf-8', { fatal: true }).decode(readPrivateBytes(tokenFile, 4096));
    protocol = codexProtocol({ endpoint, token, timeoutMs: 15000, event: () => {},
      approval: async () => { protocol?.close(); throw new Error('Read-only operator inspection cannot answer native requests'); } }, signal);
    await protocol.request('initialize', { clientInfo: { name: 'crossfire-operator-inspection', version: codexClientVersion }, capabilities: { experimentalApi: true } });
    protocol.notify('initialized');
    const account = object(await protocol.request('account/read', { refreshToken: false }));
    if (!account.ok || !account.value.account) return failure('unauthorized', 'The selected native engine has no provider login');
    const result = object(await protocol.request('thread/read', { threadId: attachment.sessionId, includeTurns: input.fresh }));
    const thread = result.ok ? object(result.value.thread) : result;
    const status = thread.ok ? object(thread.value.status) : thread;
    if (!thread.ok || !status.ok || thread.value.id !== attachment.sessionId || thread.value.cwd !== attachment.workspace
      || realpathSync(attachment.workspace) !== attachment.workspace || thread.value.canAcceptDirectInput !== true || typeof status.value.type !== 'string') return failure('conflict', 'Native thread does not match its exact running attachment/workspace');
    if (input.fresh && (status.value.type !== 'idle' || !Array.isArray(thread.value.turns) || thread.value.turns.length !== 0)) return failure('conflict', 'The selected native history is not idle and unused; inspection did not interrupt it');
    const configured = settings.value.options;
    const admitted = await admitCodex(protocol.request, configured);
    if (!admitted.ok) return admitted;
    const discovered = object(await protocol.request('skills/list', { cwds: [attachment.workspace], forceReload: true }));
    if (!discovered.ok || !Array.isArray(discovered.value.data)) return failure('native', 'Invalid native skill catalog');
    const current = discovered.value.data.map(object).find(item => item.ok && item.value.cwd === attachment.workspace);
    if (!current?.ok || !Array.isArray(current.value.errors) || current.value.errors.length || !Array.isArray(current.value.skills)) return failure('native', 'Native project skill discovery reported errors');
    const projectSkills: { name: string; path: string }[] = [];
    for (const entry of current.value.skills) {
      const item = object(entry);
      if (!item.ok || item.value.scope !== 'repo') continue;
      if (typeof item.value.name !== 'string' || typeof item.value.path !== 'string') return failure('native', 'Invalid native project skill entry');
      projectSkills.push({ name: item.value.name, path: item.value.path });
    }
    for (const name of input.requiredSkills) if (!projectSkills.some(skill => skill.name === name)) return failure('conflict', 'Required ancestor project skill is not available: ' + name);
    return success({ sessionId: attachment.sessionId, status: status.value.type, authenticated: true,
      configuredModel: configured.model ?? null, configuredReasoning: configured.model_reasoning_effort ?? null,
      projectSkills, turns: input.fresh ? 0 : null });
  } catch { return failure('native', 'Read-only Codex inspection failed; no native content or credentials are printed'); }
  finally { if (protocol) { protocol.close(); await protocol.closed; } }
};
