import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as check from '@crossfire/contracts/schema/validation';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';
import { failure, success } from '@crossfire/kernel/result';
import type { OwnedRuntimeAdapter } from '@crossfire/agent-core/owned-runtime';
import { openSession } from './session.js';
import { codexDelivery, type CodexConnection } from './connection.js';
import { startProcess } from './owned-process.js';
import { prepareHome } from './home.js';
import { approvalRouting } from './permission-policy.js';

const options = check.object({ model: check.optional(check.text(200)), model_reasoning_effort: check.optional(check.choice('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'ultra')),
  sandbox_mode: check.choice('read-only', 'workspace-write', 'danger-full-access'), approval_policy: check.choice('untrusted', 'on-failure', 'on-request', 'never') });
const state = check.object({ sessionId: check.identifier });
export function codexRuntime(binary = 'codex'): OwnedRuntimeAdapter {
  return { validate(input) {
    const parsed = options(input);
    if (!parsed.ok) return parsed;
    const approval = approvalRouting(parsed.value.approval_policy);
    return approval.ok ? success({ options: parsed.value, approval: approval.value }) : approval;
  }, async start(input, stop) {
    const parsed = options(input.options);
    if (!parsed.ok) return parsed;
    let process: Awaited<ReturnType<typeof startProcess>> | undefined;
    try {
      const home = prepareHome(input.workspace), stateFile = join(home, 'crossfire-session.json');
      const saved = existsSync(stateFile) ? state(readJson<unknown>(stateFile)) : success(null);
      if (!saved.ok) return saved;
      process = await startProcess(home, input.workspace, stop, binary);
      const owner = process;
      let connection: CodexConnection | undefined;
      const session = await openSession({ workspace: input.workspace, endpoint: owner.endpoint, token: owner.token },
        saved.value ? { kind: 'resume', id: saved.value.sessionId, instructions: input.instructions, config: parsed.value }
          : { kind: 'create', name: input.name, instructions: input.instructions, config: parsed.value },
        AbortSignal.any([stop, owner.signal]), input.hooks, event => connection?.event(event));
      writeJson(stateFile, { sessionId: session.sessionId });
      connection = codexDelivery({ ...session, close: async () => { await session.close(); await owner.close(); } },
        { pollMs: 1000, timeoutMs: 30000, receiptFile: stateFile + '.receipt' });
      await connection.verify();
      return success({ ...connection, attachment: { runtime: 'codex', sessionId: session.sessionId,
        workspace: session.workspace, connection: { endpoint: owner.endpoint, tokenFile: owner.tokenFile, home, binary: owner.binary, path: owner.path } } });
    } catch (error) { await process?.close(); return failure('native', error instanceof Error ? error.message : 'Codex startup failed'); }
  } };
}
