import { truncateUtf16 } from '@ctlflow/crossfire-kernel/text';
import { realpathSync } from 'node:fs';
import type { Json } from '@ctlflow/crossfire-kernel/json';
import type { RuntimeApproval, RuntimeHooks, RuntimeDecision } from '@ctlflow/crossfire-agent-core/runtime';
import { codexPermission, permissionDenial } from './approval.js';
import { object } from '@ctlflow/crossfire-contracts/validation';
import { codexProtocol, type NativeEvent } from './protocol.js';
import { approvalRouting } from './permission-policy.js';
import { codexQuestion, validQuestionAnswer } from './questions.js';
import { nativeObservation } from './observation.js';
import { admitCodex } from './admission.js';
import { failureError } from '@ctlflow/crossfire-kernel/result';
import { codexClientVersion } from './version.js';

export type SessionOptions = {
  workspace: string; endpoint: string; token: string; timeoutMs?: number;
};
export type CodexSession = {
  sessionId: string; workspace: string; signal: AbortSignal;
  approval: RuntimeApproval;
  request: (method: string, params: unknown, scope?: AbortSignal) => Promise<unknown>;
  close: () => Promise<void>;
};

export type ThreadSelection = { kind: 'create'; name: string; config: Record<string, unknown> }
  | { kind: 'resume'; id: string; config: Record<string, unknown> };
export async function openSession(options: SessionOptions, selection: ThreadSelection, stop: AbortSignal, hooks: RuntimeHooks,
  event: (event: NativeEvent) => void): Promise<CodexSession> {
  let sessionId = selection.kind === 'create' ? '' : selection.id;
  if (selection.kind !== 'create' && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(sessionId)) throw new Error('Supply the exact Codex session UUID');
  const workspace = realpathSync(options.workspace);
  const changes = new Map<string, Json>();
  const decisions = new Map<string, RuntimeDecision>();
  const observer = nativeObservation(hooks, () => sessionId);
  const engine = codexProtocol({ endpoint: options.endpoint, token: options.token, timeoutMs: options.timeoutMs ?? 30_000,
    event: notice => {
      if (notice.params.threadId === sessionId && ['item/started', 'item/completed'].includes(notice.method)) {
        const item = notice.params.item;
        if (item && typeof item === 'object' && 'type' in item && item.type === 'fileChange' && 'id' in item && 'changes' in item) {
          if (typeof item.id !== 'string' || !item.id) throw new Error('Invalid pending native file identity');
          if (notice.method === 'item/completed') changes.delete(item.id);
          else {
            changes.set(item.id, structuredClone(item.changes) as Json);
          }
        }
      }
      observer.event(notice); event(notice);
    },
    responded: request => {
      const decision = decisions.get(JSON.stringify(request.id));
      if (decision) { hooks.decisionResponded?.(decision); decisions.delete(JSON.stringify(request.id)); }
    },
    approval: async (request, signal) => {
      const decoded = request.method === 'item/tool/requestUserInput' ? codexQuestion(request, sessionId)
        : codexPermission(request, sessionId, changes.get(String(request.params.itemId)));
      if (!decoded.ok) throw new Error(decoded.error.message);
      const response = await hooks.requestDecision(decoded.value, signal);
      if (!response.ok && !decoded.value.questions) {
        const denied = permissionDenial(decoded.value);
        if (denied !== undefined) return denied;
      }
      if (response.ok) {
        if (decoded.value.questions ? !validQuestionAnswer(decoded.value, response.value)
          : !decoded.value.choices.some(choice => JSON.stringify(choice.value) === JSON.stringify(response.value))) throw new Error('Response is not a native available decision');
        decisions.set(JSON.stringify(request.id), decoded.value);
        return response.value;
      }
      throw new Error(response.error.message);
    },
  }, stop);
  async function close(): Promise<void> { engine.close(); await engine.closed; }
  try {
    const initialized = object(await engine.request('initialize', { clientInfo: { name: 'crossfire', title: 'crossfire listener', version: codexClientVersion },
      capabilities: { experimentalApi: true } }));
    const version = initialized.ok && typeof initialized.value.userAgent === 'string' ? initialized.value.userAgent : null;
    engine.notify('initialized');
    let approval: RuntimeApproval | undefined;
    {
      const admitted = await admitCodex(engine.request, selection.config);
      if (!admitted.ok) throw failureError(admitted.error);
      const selected = object(await engine.request(selection.kind === 'create' ? 'thread/start' : 'thread/resume', {
        cwd: workspace, config: { ...selection.config, model: admitted.value.model, model_reasoning_effort: admitted.value.effort },
        ...(selection.kind === 'resume' ? { threadId: selection.id, excludeTurns: true } : { historyMode: 'paginated', ephemeral: false }),
      }));
      const thread = selected.ok ? object(selected.value.thread) : selected;
      if (!thread.ok || typeof thread.value.id !== 'string' || selection.kind === 'resume' && thread.value.id !== selection.id) throw new Error('Codex did not select the requested session');
      sessionId = thread.value.id;
      const routing = selected.ok ? approvalRouting(selected.value.approvalPolicy) : selected;
      if (!routing.ok) throw new Error(routing.error.message);
      approval = routing.value;
      if (selected.ok) {
        if (typeof selected.value.model !== 'string' || !selected.value.model
          || selected.value.reasoningEffort !== null && typeof selected.value.reasoningEffort !== 'string') throw new Error('Codex did not expose its selected native model and reasoning settings');
        observer.configure(selection.config, selected.value, version);
        const sandbox = object(selected.value.sandbox);
        const sandboxTypes: Record<string, string> = { 'danger-full-access': 'dangerFullAccess', 'workspace-write': 'workspaceWrite', 'read-only': 'readOnly' };
        if (selection.config.sandbox_mode !== undefined && (!sandbox.ok || sandbox.value.type !== sandboxTypes[String(selection.config.sandbox_mode)])
          || selection.config.approval_policy !== undefined && selected.value.approvalPolicy !== selection.config.approval_policy
          || selected.value.model !== admitted.value.model
          || selected.value.reasoningEffort !== admitted.value.effort) {
          throw failureError({ code: 'invalid', message: 'Codex did not apply the selected model, reasoning, sandbox and approval settings: requested '
            + admitted.value.model + '/' + admitted.value.effort + ', reported ' + truncateUtf16(String(selected.value.model), 200)
            + '/' + truncateUtf16(String(selected.value.reasoningEffort), 100) });
        }
      }
      if (selection.kind === 'create') await engine.request('thread/name/set', { threadId: sessionId, name: selection.name });
    }
    const read = object(await engine.request('thread/read', { threadId: sessionId, includeTurns: selection.kind === 'create' }));
    const thread = read.ok ? object(read.value.thread) : read;
    const state = thread.ok ? object(thread.value.status) : thread;
    if (!thread.ok || !state.ok || thread.value.id !== sessionId || thread.value.canAcceptDirectInput !== true
      || !['idle', 'active'].includes(String(state.value.type)) || typeof thread.value.cwd !== 'string'
      || realpathSync(thread.value.cwd) !== workspace) throw new Error('The selected Codex session must be loaded in this exact workspace');
    if (!approval) throw new Error('Native approval policy was not selected');
    observer.state(state.value.type === 'idle' ? 'idle' : 'working');
    engine.signal.addEventListener('abort', () => {
      if (!stop.aborted) observer.state('failed', engine.signal.reason instanceof Error ? engine.signal.reason.message : 'Native connection ended unexpectedly');
    }, { once: true });
    return { sessionId, workspace, approval, signal: engine.signal, request: engine.request, close };
  } catch (error) { await close(); throw error; }
}
