import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { trustWorkspace } from '@ctlflow/crossfire-test-support/codex';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { until } from '../scripts/test-support/listener.js';
import { value } from '@ctlflow/crossfire-test-support/result';
import { codexTerminal } from '@ctlflow/crossfire-adapter-codex/terminal';
import { openTerminal } from '../scripts/test-support/terminal.js';
import { builtRelease } from '../scripts/test-support/release.js';
import { codexProtocol } from '@ctlflow/crossfire-adapter-codex/protocol';
import type { OwnedRuntimeConnection } from '@ctlflow/crossfire-agent-core/owned-runtime';

async function instructionItems(runtime: OwnedRuntimeConnection) {
  const connection = runtime.attachment.connection;
  assert(connection.endpoint && connection.tokenFile);
  const protocol = codexProtocol({ endpoint: connection.endpoint, token: readFileSync(connection.tokenFile, 'utf8'), timeoutMs: 10000,
    event: () => {}, approval: async () => { throw new Error('Read-only instruction inspection cannot answer a native decision'); } }, new AbortController().signal);
  try {
    await protocol.request('initialize', { clientInfo: { name: 'crossfire-native-instruction-proof', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    protocol.notify('initialized');
    const response = await protocol.request('thread/read', { threadId: runtime.sessionId, includeTurns: false }) as { thread: { id: string; cwd: string; path: string } };
    assert.equal(response.thread.id, runtime.sessionId); assert.equal(response.thread.cwd, runtime.attachment.workspace);
    const bytes = readFileSync(response.thread.path); assert(bytes.length < 1024 * 1024, 'Inert native history stays within its proof byte budget');
    const records = bytes.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string; payload: {
      id?: string; role?: string; type?: string; content?: { type: string; text: string }[] } });
    return records.filter(record => record.type === 'response_item' && record.payload.id?.startsWith('crossfire-instructions-')).map(record => {
      assert.equal(record.payload.type, 'message'); assert.equal(record.payload.role, 'developer');
      assert.equal(record.payload.content?.length, 1); assert.equal(record.payload.content?.[0]?.type, 'input_text');
      return { id: record.payload.id, text: record.payload.content![0]!.text };
    });
  } finally { protocol.close(); await protocol.closed; }
}

test('stock Codex default and native bypass execute synchronous subprocess IPC and resume the same session', { timeout: 60000 }, async scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/owned-options-'));
  const workspace = join(directory, 'workspace'), home = join(workspace, '.codex');
  mkdirSync(workspace, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  writeFileSync(join(home, 'auth.json'), '{}', { mode: 0o600 });
  const provider = await nativeProvider(scope, home), adapter = codexRuntime(), stop = new AbortController();
  trustWorkspace(home, workspace);
  const input = { name: 'native-options', workspace, stateDirectory: workspace, instructions: 'Inert native option proof.', allowNewHistory: true,
    options: {} as Record<string, unknown>, hooks: { requestDecision: async () => { throw new Error('Unexpected fixture approval'); } } };
  let runtime = value(await adapter.start(input, stop.signal));
  input.allowNewHistory = false;
  cleanup(scope, () => runtime.close());
  const sessionId = runtime.sessionId;
  const initialInstructions = await instructionItems(runtime); assert.equal(initialInstructions.length, 1);
  assert.equal(runtime.approval, 'listener');
  assert.equal(provider.requests.length, 0);
  for (const bypass of [false, true]) {
    if (bypass) {
      await runtime.close();
      input.options = { dangerously_bypass_approvals_and_sandbox: true };
      runtime = value(await adapter.start(input, stop.signal));
      assert.equal(runtime.sessionId, sessionId);
      assert.equal(runtime.approval, 'none');
      assert.deepEqual(await instructionItems(runtime), initialInstructions, 'Permission changes do not append unchanged role instructions');
    }
    const marker = join(directory, 'ipc-' + bypass + '.txt');
    const source = 'const {spawnSync}=require("node:child_process");const {writeFileSync}=require("node:fs");'
      + 'const child=spawnSync(process.execPath,["-e","process.stdin.pipe(process.stdout)"],{input:"captured-IPC",encoding:"utf8"});'
      + 'if(child.error||child.status!==0||child.stdout!=="captured-IPC")throw child.error||new Error(JSON.stringify(child));'
      + 'const git=spawnSync("git",["--version"],{encoding:"utf8"});if(git.error||git.status!==0)throw git.error||new Error("Git failed");'
      + 'writeFileSync(' + JSON.stringify(marker) + ',child.stdout);';
    provider.tool('exec_command', { cmd: 'node -e ' + JSON.stringify(source), yield_time_ms: 1000, max_output_tokens: 1024 });
    await runtime.deliver('Run the inert synchronous IPC control', 'native-default-' + bypass, stop.signal);
    await until(() => existsSync(marker));
    assert.equal(readFileSync(marker, 'utf8'), 'captured-IPC');
    await until(async () => await runtime.turnControl.activeTurn() === null, 'Native IPC control did not become idle');
  }
  assert.equal(provider.requests.length, 4);
});

test('external native workspaces retain private managed state, explicit role skills and exact history across restart and reset', { timeout: 60000 }, async scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/external-owned-codex-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'existing-project'), stateDirectory = join(directory, 'private-state'), home = join(stateDirectory, '.codex');
  mkdirSync(workspace, { mode: 0o755 }); mkdirSync(stateDirectory, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  const existing = join(workspace, '.codex'); mkdirSync(existing, { mode: 0o700 });
  writeFileSync(join(existing, 'existing-history'), 'Existing coding session remains independent', { mode: 0o600 });
  writeFileSync(join(home, 'auth.json'), '{}', { mode: 0o600 });
  const provider = await nativeProvider(scope, home), adapter = codexRuntime(process.env.CROSSFIRE_TEST_CODEX ?? 'codex');
  trustWorkspace(home, workspace);
  const skill = readFileSync(join(builtRelease().directory, 'SKILL.md'), 'utf8');
  const input = { name: 'private-managed-agent', workspace, stateDirectory, allowNewHistory: true,
    instructions: 'Role instructions: external-workspace-proof.\n\n' + skill,
    options: { sandbox_mode: 'danger-full-access', approval_policy: 'never' },
    hooks: { requestDecision: async () => { throw new Error('No fixture approval is expected'); } } };
  let runtime = value(await adapter.start(input, new AbortController().signal)); cleanup(scope, () => runtime.close());
  input.allowNewHistory = false;
  const sessionId = runtime.sessionId, marker = join(stateDirectory, 'environment.json');
  assert.equal((await instructionItems(runtime)).length, 1);
  assert.equal(runtime.attachment.workspace, workspace); assert.equal(runtime.attachment.connection.home, home);
  assert.equal(provider.requests.length, 0);
  const source = 'require("node:fs").writeFileSync(' + JSON.stringify(marker)
    + ',JSON.stringify({cwd:process.cwd(),home:process.env.CODEX_HOME,state:process.env.CROSSFIRE_PROJECT,name:process.env.CROSSFIRE_AGENT_NAME}));';
  provider.tool('exec_command', { cmd: 'node -e ' + JSON.stringify(source), yield_time_ms: 1000, max_output_tokens: 1024 });
  await runtime.deliver('Retain external native history: silver orchard 913.', 'external-environment-proof');
  await until(() => existsSync(marker), 'Native tools did not retain the explicit private state binding');
  assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), { cwd: workspace, home, state: stateDirectory, name: input.name });
  runtime.acknowledge(['external-environment-proof']); await until(async () => !(await runtime.inspect()).busy);
  assert.equal(provider.requests.length, 2);
  assert(JSON.stringify(provider.requests[0]).includes('external-workspace-proof'));
  assert(JSON.stringify(provider.requests[0]).includes('Machine information and recipients'));
  assert.equal((provider.requests[0] as { model: string }).model, 'fixture-model', 'Native provider/model defaults remain selected');
  await runtime.close();
  assert.deepEqual(readdirSync(existing), ['existing-history']);
  assert.equal(readFileSync(join(existing, 'existing-history'), 'utf8'), 'Existing coding session remains independent');
  assert(existsSync(join(home, 'crossfire-session.json')));
  assert.deepEqual(value(await adapter.savedContexts({ workspace, stateDirectory })), [{ context: 'shared', runtime: 'codex', sessionId, workspace }]);
  input.instructions = 'Updated role instructions: resumed-external-workspace-proof.\n\n' + skill;
  runtime = value(await adapter.start(input, new AbortController().signal)); assert.equal(runtime.sessionId, sessionId);
  assert.equal((await instructionItems(runtime)).length, 2, 'One changed role creates one native developer revision');
  provider.hold(); await runtime.deliver('Use the original historical fact.', 'external-resume-proof');
  await until(() => provider.held() !== undefined);
  const resumedRequest = provider.requests.at(-1);
  provider.finish(); runtime.acknowledge(['external-resume-proof']); await until(async () => !(await runtime.inspect()).busy);
  assert(JSON.stringify(resumedRequest).includes('silver orchard 913'));
  assert(JSON.stringify(resumedRequest).includes('resumed-external-workspace-proof'));
  await runtime.close();
  value(await adapter.reset({ workspace, stateDirectory, resetId: '5a2435b3-f3bb-482c-8b99-51e5afcae258' }));
  runtime = value(await adapter.start({ ...input, allowNewHistory: true }, new AbortController().signal));
  assert.notEqual(runtime.sessionId, sessionId); assert.equal(provider.requests.length, 3);
  assert.equal((await instructionItems(runtime)).length, 1, 'Explicit fresh history owns its own first instruction receipt');
  assert.deepEqual(readdirSync(existing), ['existing-history']);
});

test('owned stock Codex has zero-model startup and resumes the same private native session', { timeout: 60000 }, async scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/owned-codex-'));
  const workspace = join(directory, 'workspace'), home = join(workspace, '.codex');
  mkdirSync(workspace, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  writeFileSync(join(home, 'auth.json'), '{}', { mode: 0o600 });
  const provider = await nativeProvider(scope, home), adapter = codexRuntime(), stop = new AbortController();
  trustWorkspace(home, workspace);
  const instructions = readFileSync(join(builtRelease().directory, 'SKILL.md'), 'utf8');
  assert(instructions.includes('Machine-specific diagnostics belong only in your verified private owner DM.'));
  assert(instructions.includes('Credentials and secret answers remain protected everywhere.'));
  const input = { name: 'native-proof', workspace, stateDirectory: workspace, instructions: instructions + '\nInert native verification. Never contact external services.', allowNewHistory: true,
    options: { model: 'gpt-6.1-sol', model_reasoning_effort: 'max', sandbox_mode: 'read-only', approval_policy: 'never' },
    hooks: { requestDecision: async () => { throw new Error('No approvals are expected'); } } };
  let runtime = value(await adapter.start(input, stop.signal));
  input.allowNewHistory = false;
  cleanup(scope, () => runtime.close());
  assert.equal(provider.requests.length, 0);
  const sessionId = runtime.sessionId;
  const initialInstructions = await instructionItems(runtime); assert.equal(initialInstructions.length, 1);
  const firstPointer = runtime.attachment;
  await runtime.close();
  assert.equal(existsSync(firstPointer.connection.tokenFile!), false);
  runtime = value(await adapter.start(input, stop.signal));
  assert.equal(runtime.sessionId, sessionId);
  assert.equal(provider.requests.length, 0);
  assert.deepEqual(await instructionItems(runtime), initialInstructions, 'Empty-history resume cannot duplicate native instructions');
  await runtime.deliver('Native owned runtime proof', 'owned-native-proof-1', stop.signal);
  await until(() => provider.requests.length === 1);
  const request = provider.requests[0] as { model: string; reasoning: { effort: string } };
  provider.finish();
  assert.equal(request.model, 'gpt-6.1-sol'); assert.equal(request.reasoning.effort, 'max', JSON.stringify(request.reasoning));
  assert(JSON.stringify(request).includes('Machine information and recipients'));
  await until(async () => await runtime.turnControl.activeTurn() === null, 'Native work did not become idle');
  await runtime.close();
  runtime = value(await adapter.start(input, stop.signal));
  assert.equal(runtime.sessionId, sessionId);
  await runtime.deliver('Native owned runtime proof', 'owned-native-proof-1', stop.signal);
  assert.equal(provider.requests.length, 1, 'Exact receipt prevents replay across engine restart');
  assert.deepEqual(await instructionItems(runtime), initialInstructions, 'Resuming after a real turn retains the original instruction identity');
  await runtime.close();
  input.instructions = input.instructions.replace('Machine information and recipients', 'Machine information and recipients (native updated skill proof)')
    + '\nUpdated Sol role: native role revision two.';
  runtime = value(await adapter.start(input, stop.signal));
  assert.equal(runtime.sessionId, sessionId); assert.equal(provider.requests.length, 1, 'Changed native role/skill revision never invokes the model');
  const updatedInstructions = await instructionItems(runtime); assert.equal(updatedInstructions.length, 2);
  assert.equal(updatedInstructions[0]!.id, initialInstructions[0]!.id); assert.notEqual(updatedInstructions[1]!.id, initialInstructions[0]!.id);
  provider.hold(); await runtime.deliver('Inspect retained history and updated instructions.', 'owned-native-revision-proof', stop.signal);
  await until(() => provider.held() !== undefined);
  const updatedRequest = provider.requests[1] as { model: string; reasoning: { effort: string }; input: { role?: string; content?: { text?: string }[] }[] };
  provider.finish(); runtime.acknowledge(['owned-native-revision-proof']);
  assert.equal(updatedRequest.model, 'gpt-6.1-sol'); assert.equal(updatedRequest.reasoning.effort, 'max');
  assert.equal(updatedRequest.input.some(item => item.role === 'developer' && item.content?.some(content => content.text === input.instructions)), true,
    'Real Sol receives the exact changed role/skill bytes as a native developer item');
  assert(JSON.stringify(updatedRequest).includes('Native owned runtime proof'), 'Changing instructions preserves previous conversation history');
  await until(async () => await runtime.turnControl.activeTurn() === null, 'Updated-role native work did not become idle');
  await runtime.close();
  runtime = value(await adapter.start(input, stop.signal));
  assert.deepEqual(await instructionItems(runtime), updatedInstructions, 'Unchanged updated skill does not accumulate instructions after another app-server restart');
  assert.equal(provider.requests.length, 2); await runtime.close();
  input.options = { model: 'gpt-5.1', model_reasoning_effort: 'medium', sandbox_mode: 'danger-full-access', approval_policy: 'never' };
  runtime = value(await adapter.start(input, stop.signal));
  assert.equal(runtime.sessionId, sessionId);
  assert.notEqual(runtime.attachment.connection.tokenFile, firstPointer.connection.tokenFile);
  const command = value(codexTerminal().command(runtime.attachment));
  assert(!command.includes(readFileSync(runtime.attachment.connection.tokenFile!, 'utf8')));
  const terminal = openTerminal(scope, command, { ...process.env, CODEX_HOME: home });
  await terminal.until(output => output.includes('gpt-5.1'));
  assert.equal(provider.requests.length, 2, 'Opening the native TUI does not call the model');
  await terminal.quit();
  assert.equal(runtime.signal.aborted, false, 'Closing the TUI leaves the owned session/listener connection alive');
  const outside = join(directory, 'outside-workspace.txt');
  provider.tool('exec_command', { cmd: 'printf full-access-confirmed > ' + JSON.stringify(outside), yield_time_ms: 1000, max_output_tokens: 1024 });
  await runtime.deliver('Inert full-access native tool control', 'owned-native-proof-2', stop.signal);
  await until(() => existsSync(outside));
  assert.equal(readFileSync(outside, 'utf8'), 'full-access-confirmed');
  await until(async () => await runtime.turnControl.activeTurn() === null, 'Native tool work did not become idle');
  const changed = provider.requests[2] as { model: string; reasoning: { effort: string } };
  assert.equal(changed.model, 'gpt-5.1'); assert.equal(changed.reasoning.effort, 'medium');
});
