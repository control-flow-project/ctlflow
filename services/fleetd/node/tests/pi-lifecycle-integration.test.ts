import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { value } from '@ctlflow/crossfire-test-support/result';
import { piProvider } from '@ctlflow/crossfire-test-support/pi-provider';
import { piBinary } from '@ctlflow/crossfire-test-support/pi';
import { piRuntime } from '@ctlflow/crossfire-adapter-pi/owned';
import { createNativeLifecycle, type NativeLifecycleServices } from '@ctlflow/fleetd-domain/native-lifecycle';
import { createResumeWork } from '@ctlflow/fleetd-storage/resume-work';
import type { Clock } from '@ctlflow/crossfire-agent-core/port';
import type { RuntimeObservationEvent } from '@ctlflow/crossfire-agent-core/runtime';
import { success } from '@ctlflow/crossfire-kernel/result';

async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 15000;
  while (!await predicate()) { assert(performance.now() < deadline, 'Pi lifecycle observation deadline'); await yieldLoop(); }
}

test('stock Pi uses common sleep, wake, stop, restart and process-crash recovery without replacing history', { timeout: 60000 }, async scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/pi-lifecycle-')), workspace = join(directory, 'workspace');
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true })); mkdirSync(workspace, { mode: 0o700 });
  const provider = await piProvider(scope), adapter = piRuntime(piBinary()), observations: RuntimeObservationEvent[] = [], failures: string[] = [];
  let now = Date.now(), sequence = 0, starts = 0, recovered = 0, allowNewHistory = true;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: Clock = { now: () => now, deadline: milliseconds => AbortSignal.timeout(milliseconds),
    schedule(callback, milliseconds) { const id = ++sequence; timers.set(id, { at: now + milliseconds, callback }); return () => { timers.delete(id); }; },
    delay: async (_milliseconds, signal) => { signal.throwIfAborted(); await yieldLoop(); signal.throwIfAborted(); } };
  async function advance(milliseconds: number) {
    now += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    await yieldLoop();
  }
  const services: NativeLifecycleServices = { clock, primary: 'shared', runtime: 'pi', approval: 'none', initial: 'running',
    initialSettings: adapter.configuredSettings({ provider: 'fixture', model: 'fixture-model', thinking_level: 'medium' }),
    work: createResumeWork(join(workspace, '.crossfire/state/pi-lifecycle'), () => now),
    saved: () => adapter.savedContexts({ workspace, stateDirectory: workspace }),
    hooks: { observe: event => observations.push(event), pendingInput: () => false, pendingDecisions: () => false, requestDecision: async () => success(null) },
    failed: (_session, error) => failures.push(error instanceof Error ? error.message : String(error)), recovered: () => { recovered++; },
    start: async (signal, observe) => {
      starts++;
      const result = await adapter.start({ profile: 'pi-lifecycle', name: 'pi-lifecycle', workspace, stateDirectory: workspace,
        instructions: 'Inert native lifecycle proof. No external work authorized.', options: { provider: 'fixture', model: 'fixture-model', thinking_level: 'medium' },
        allowNewHistory, hooks: { ...services.hooks, observe } }, signal);
      if (result.ok) allowNewHistory = false;
      return result;
    } };
  let managed = value(await createNativeLifecycle(services, new AbortController().signal)); cleanup(scope, () => managed.close());
  await managed.activate(); const sessionId = managed.runtime.sessionId;
  assert.equal(provider.requests.length, 0); assert.equal((await managed.attachment()).ok, false, 'Pi attachment never creates another writer');
  provider.hold(); await managed.runtime.deliver('Retain the original Pi task and its room destination.', 'pi-lifecycle-one');
  managed.runtime.acknowledge(['pi-lifecycle-one']); await until(() => provider.held() !== undefined);
  await advance(1800000); assert.equal(managed.nativeState().phase, 'running', 'Working Pi cannot idle-sleep');
  provider.finish(); await until(async () => !(await managed.runtime.inspect()).busy);
  await advance(1800000); await until(() => managed.nativeState().phase === 'sleeping');
  assert.equal(starts, 1); assert.equal(value(await managed.contexts())[0]?.sessionId, sessionId);
  writeFileSync(join(provider.home, 'auth.json'), '{"fixture":{"type":"api_key","key":"refreshed-local"}}', { mode: 0o600 });
  await managed.runtime.deliver('Resume with native earlier context.', 'pi-lifecycle-two'); managed.runtime.acknowledge(['pi-lifecycle-two']);
  await until(async () => !(await managed.runtime.inspect()).busy);
  assert.equal(starts, 2); assert.equal(managed.runtime.sessionId, sessionId);
  assert(JSON.stringify(provider.requests[1]).includes('Retain the original Pi task'));
  assert.equal(readFileSync(join(workspace, '.pi/auth.json'), 'utf8'), readFileSync(join(provider.home, 'auth.json'), 'utf8'));
  provider.hold(); await managed.runtime.deliver('Unfinished Pi task before controller restart.', 'pi-lifecycle-unfinished');
  managed.runtime.acknowledge(['pi-lifecycle-unfinished']); await until(() => provider.held() !== undefined);
  await until(() => value(services.work.read()).length === 1); await managed.close(); services.initial = 'sleeping';
  managed = value(await createNativeLifecycle(services, new AbortController().signal));
  assert.equal(provider.requests.length, 3, 'No continuation before listener readiness'); await managed.activate();
  await until(() => provider.requests.length === 4); await until(async () => !(await managed.runtime.inspect()).busy);
  assert.equal(starts, 3); assert.equal(managed.runtime.sessionId, sessionId);
  assert(JSON.stringify(provider.requests[3]).includes('[Crossfire session restarted]'));
  assert(JSON.stringify(provider.requests[3]).includes('Unfinished Pi task before controller restart.'));
  assert.deepEqual(value(services.work.read()), []);
  const marker = join(directory, 'native.pid'); provider.tool('bash', { command: 'printf "%s" "$PPID" > ' + JSON.stringify(marker), timeout: 5 });
  await managed.runtime.deliver('Record the inert native process identity for a crash test.', 'pi-lifecycle-crash');
  managed.runtime.acknowledge(['pi-lifecycle-crash']); await until(async () => !(await managed.runtime.inspect()).busy);
  const pid = Number(readFileSync(marker, 'utf8')); assert(Number.isSafeInteger(pid) && pid > 1);
  if (process.platform === 'linux') {
    const environment = readFileSync('/proc/' + pid + '/environ', 'utf8').split('\0');
    assert(environment.includes('PI_CODING_AGENT_DIR=' + join(workspace, '.pi')) && environment.includes('CROSSFIRE_AGENT_NAME=pi-lifecycle'),
      'Crash target has this fixture’s exact private Pi home and immutable instance profile');
  }
  const recoveredBeforeCrash = recovered;
  process.kill(pid, 'SIGKILL'); await until(() => starts === 4 && recovered === recoveredBeforeCrash + 1);
  await until(() => managed.nativeState().phase === 'running');
  assert.equal(managed.runtime.sessionId, sessionId); assert.equal(failures.length, 1); assert.equal(provider.requests.length, 6);
  await managed.runtime.deliver('Continue after process recovery.', 'pi-lifecycle-recovered'); managed.runtime.acknowledge(['pi-lifecycle-recovered']);
  await until(async () => !(await managed.runtime.inspect()).busy);
  assert(JSON.stringify(provider.requests[6]).includes('Retain the original Pi task'));
  assert(observations.some(event => event.kind === 'state' && event.observation.state === 'failed'));
  assert(observations.some(event => event.kind === 'state' && event.observation.state === 'sleeping'));
  for (const request of provider.requests) assert.equal((request.reasoning_effort), 'medium', 'Every Pi activation uses exact configured thinking');
});
