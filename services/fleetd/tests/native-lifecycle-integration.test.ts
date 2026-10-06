import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { trustWorkspace } from '@ctlflow/crossfire-test-support/codex';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';
import { success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';
import type { RuntimeObservationEvent } from '@ctlflow/crossfire-agent-core/runtime';
import { createNativeLifecycle, type NativeLifecycleServices } from '@ctlflow/fleetd-domain/native-lifecycle';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.code + ': ' + result.error.message); return result.value; }
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 15000;
  while (!await predicate()) { assert(performance.now() < deadline, 'Native lifecycle integration observation deadline'); await yieldLoop(); }
}

test('stock Codex sleeps, wakes and survives binding restart with exact full history through the shared lifecycle interface', { timeout: 60000 }, async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-native-sleep-')), workspace = join(directory, 'workspace'), home = join(workspace, '.codex');
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  mkdirSync(workspace, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  writeFileSync(join(home, 'auth.json'), '{}', { mode: 0o600 });
  const provider = await nativeProvider(scope, home); trustWorkspace(home, workspace);
  const adapter = codexRuntime(), stop = new AbortController(), observations: RuntimeObservationEvent[] = [];
  const failures: string[] = [];
  let now = Date.now(), sequence = 0, starts = 0, allowNewHistory = true;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: Clock = { now: () => now, deadline: milliseconds => AbortSignal.timeout(milliseconds),
    schedule(callback, milliseconds) { const id = ++sequence; timers.set(id, { at: now + milliseconds, callback }); return () => { timers.delete(id); }; },
    delay: async (_milliseconds, signal) => { signal.throwIfAborted(); await yieldLoop(); signal.throwIfAborted(); },
  };
  async function advance(milliseconds: number): Promise<void> {
    now += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    await yieldLoop();
  }
  const options = { sandbox_mode: 'read-only', approval_policy: 'never' };
  const services: NativeLifecycleServices = { clock, primary: 'shared', runtime: 'codex', approval: value(adapter.validate(options)).approval,
    initial: 'running', initialSettings: [], saved: () => adapter.savedContexts({ workspace, stateDirectory: workspace }),
    hooks: { observe: event => observations.push(event), pendingInput: () => false, pendingDecisions: () => false,
      requestDecision: async () => success(null) },
    failed: (_session, error) => { failures.push(error instanceof Error ? error.message : 'Unexpected native failure'); }, recovered: () => {},
    start: async (signal, observe) => {
      starts++;
      const started = await adapter.start({ profile: 'native-sleep-proof', name: 'native-sleep-proof', workspace, stateDirectory: workspace, instructions: 'Inert provider proof; do not access external services.',
        options, allowNewHistory, hooks: { ...services.hooks, observe } }, signal);
      if (started.ok) allowNewHistory = false;
      return started;
    },
  };
  let managed = value(await createNativeLifecycle(services, stop.signal)); cleanup(scope, () => managed.close());
  const history = managed.runtime.sessionId, firstPointer = value(await managed.attachment());
  assert.equal(provider.requests.length, 0, 'Startup does not call a model');
  await managed.runtime.deliver('First retained native sleep proof', 'sleep-proof-one'); managed.runtime.acknowledge(['sleep-proof-one']);
  await until(() => provider.held() !== undefined);
  await advance(1800000); assert.equal(managed.nativeState().phase, 'running', 'A native working turn vetoes idle sleep');
  provider.finish(); await until(async () => !(await managed.runtime.inspect()).busy);
  await advance(1800000); await until(() => managed.nativeState().phase === 'sleeping');
  assert.equal(managed.runtime.signal.aborted, false); assert.equal(existsSync(firstPointer.connection.tokenFile!), false);
  assert.equal((await managed.attachment()).ok, false); assert.equal(value(await managed.contexts())[0]!.sessionId, history);
  assert.equal(starts, 1); assert.equal(provider.requests.length, 1, 'Sleep and metadata reads call no model');
  value(await managed.resume()); assert.equal(starts, 2); assert.equal(provider.requests.length, 1, 'Explicit resume creates no model input');
  assert.equal(value(await managed.attachment()).sessionId, history);
  await managed.runtime.deliver('Second retained native sleep proof', 'sleep-proof-two'); managed.runtime.acknowledge(['sleep-proof-two']);
  await until(() => provider.requests.length === 2); await until(async () => !(await managed.runtime.inspect()).busy);
  assert.equal(managed.runtime.sessionId, history); assert.equal(starts, 2);
  assert(JSON.stringify(provider.requests[1]).includes('First retained native sleep proof'), 'Wake retains earlier native context');
  await managed.close(); services.initial = 'sleeping';
  managed = value(await createNativeLifecycle(services, new AbortController().signal));
  assert.equal(managed.runtime.sessionId, history); assert.equal(starts, 2); assert.equal(managed.nativeState().phase, 'sleeping');
  await managed.runtime.deliver('Third retained native sleep proof', 'sleep-proof-three'); managed.runtime.acknowledge(['sleep-proof-three']);
  await until(() => provider.requests.length === 3); await until(async () => !(await managed.runtime.inspect()).busy);
  assert.equal(managed.runtime.sessionId, history); assert.equal(starts, 3);
  assert(JSON.stringify(provider.requests[2]).includes('Second retained native sleep proof'), 'Controller binding restart preserves full native context');
  assert(observations.some(event => event.kind === 'state' && event.observation.state === 'sleeping'));
  assert(observations.some(event => event.kind === 'state' && event.observation.state === 'waking'));
  assert.equal(failures.length, 0, failures.join('; '));
});
