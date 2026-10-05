import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { trustWorkspace } from '@ctlflow/crossfire-test-support/codex';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { until } from '../scripts/test-support/listener.js';
import { value } from './support/application.js';
import { codexTerminal } from '@ctlflow/crossfire-adapter-codex/terminal';
import { openTerminal } from '../scripts/test-support/terminal.js';
import { builtRelease } from '../scripts/test-support/release.js';

test('stock Codex default and native bypass execute synchronous subprocess IPC and resume the same session', { timeout: 60000 }, async scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/owned-options-'));
  const workspace = join(directory, 'workspace'), home = join(workspace, '.codex');
  mkdirSync(workspace, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  writeFileSync(join(home, 'auth.json'), '{}', { mode: 0o600 });
  const provider = await nativeProvider(scope, home), adapter = codexRuntime(), stop = new AbortController();
  trustWorkspace(home, workspace);
  const input = { name: 'native-options', workspace, instructions: 'Inert native option proof.', allowNewHistory: true,
    options: {} as Record<string, unknown>, hooks: { requestDecision: async () => { throw new Error('Unexpected fixture approval'); } } };
  let runtime = value(await adapter.start(input, stop.signal));
  input.allowNewHistory = false;
  cleanup(scope, () => runtime.close());
  const sessionId = runtime.sessionId;
  assert.equal(runtime.approval, 'listener');
  assert.equal(provider.requests.length, 0);
  for (const bypass of [false, true]) {
    if (bypass) {
      await runtime.close();
      input.options = { dangerously_bypass_approvals_and_sandbox: true };
      runtime = value(await adapter.start(input, stop.signal));
      assert.equal(runtime.sessionId, sessionId);
      assert.equal(runtime.approval, 'none');
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
    const deadline = performance.now() + 5000;
    while (await runtime.turnControl.activeTurn() !== null) {
      assert(performance.now() < deadline, 'Native IPC control did not become idle'); await delay(25);
    }
  }
  assert.equal(provider.requests.length, 4);
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
  const input = { name: 'native-proof', workspace, instructions: instructions + '\nInert native verification. Never contact external services.', allowNewHistory: true,
    options: { model: 'gpt-6.1-sol', model_reasoning_effort: 'max', sandbox_mode: 'read-only', approval_policy: 'never' },
    hooks: { requestDecision: async () => { throw new Error('No approvals are expected'); } } };
  let runtime = value(await adapter.start(input, stop.signal));
  input.allowNewHistory = false;
  cleanup(scope, () => runtime.close());
  assert.equal(provider.requests.length, 0);
  const sessionId = runtime.sessionId;
  const firstPointer = runtime.attachment;
  await runtime.close();
  assert.equal(existsSync(firstPointer.connection.tokenFile!), false);
  runtime = value(await adapter.start(input, stop.signal));
  assert.equal(runtime.sessionId, sessionId);
  assert.equal(provider.requests.length, 0);
  await runtime.deliver('Native owned runtime proof', 'owned-native-proof-1', stop.signal);
  await until(() => provider.requests.length === 1);
  const request = provider.requests[0] as { model: string; reasoning: { effort: string } };
  assert.equal(request.model, 'gpt-6.1-sol'); assert.equal(request.reasoning.effort, 'max', JSON.stringify(request.reasoning));
  assert(JSON.stringify(request).includes('Machine information and recipients'));
  provider.finish();
  let deadline = performance.now() + 5000;
  while (await runtime.turnControl.activeTurn() !== null) { assert(performance.now() < deadline, 'Native work did not become idle'); await delay(50); }
  await runtime.close();
  runtime = value(await adapter.start(input, stop.signal));
  assert.equal(runtime.sessionId, sessionId);
  await runtime.deliver('Native owned runtime proof', 'owned-native-proof-1', stop.signal);
  assert.equal(provider.requests.length, 1, 'Exact receipt prevents replay across engine restart');
  await runtime.close();
  input.options = { model: 'gpt-5.1', model_reasoning_effort: 'medium', sandbox_mode: 'danger-full-access', approval_policy: 'never' };
  runtime = value(await adapter.start(input, stop.signal));
  assert.equal(runtime.sessionId, sessionId);
  assert.notEqual(runtime.attachment.connection.tokenFile, firstPointer.connection.tokenFile);
  const command = value(codexTerminal().command(runtime.attachment));
  assert(!command.includes(readFileSync(runtime.attachment.connection.tokenFile!, 'utf8')));
  const terminal = openTerminal(scope, command, { ...process.env, CODEX_HOME: home });
  await terminal.until(output => output.includes('gpt-5.1'));
  assert.equal(provider.requests.length, 1, 'Opening the native TUI does not call the model');
  await terminal.quit();
  assert.equal(runtime.signal.aborted, false, 'Closing the TUI leaves the owned session/listener connection alive');
  const outside = join(directory, 'outside-workspace.txt');
  provider.tool('exec_command', { cmd: 'printf full-access-confirmed > ' + JSON.stringify(outside), yield_time_ms: 1000, max_output_tokens: 1024 });
  await runtime.deliver('Inert full-access native tool control', 'owned-native-proof-2', stop.signal);
  await until(() => existsSync(outside));
  assert.equal(readFileSync(outside, 'utf8'), 'full-access-confirmed');
  deadline = performance.now() + 5000;
  while (await runtime.turnControl.activeTurn() !== null) { assert(performance.now() < deadline, 'Native tool work did not become idle'); await delay(50); }
  const changed = provider.requests[1] as { model: string; reasoning: { effort: string } };
  assert.equal(changed.model, 'gpt-5.1'); assert.equal(changed.reasoning.effort, 'medium');
});
