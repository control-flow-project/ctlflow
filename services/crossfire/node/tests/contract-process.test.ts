import assert from 'node:assert/strict';
import test from 'node:test';
import { contractProcess, observe } from '@ctlflow/crossfire-test-support/contract-process';

test('contract process distinguishes signal termination from a running process', async context => {
  const running = contractProcess(context, { binary: process.execPath, arguments: ['-e', 'console.log("ready"); process.stdin.resume(); setInterval(() => {}, 60000);'] }, [], process.cwd());
  await observe(() => running.output().includes('ready'), 'The isolated process must start');
  assert.equal(running.alive(), true);
  running.child.kill('SIGTERM');
  assert.equal(await running.ended, null);
  assert.equal(running.child.exitCode, null);
  assert.equal(running.child.signalCode, 'SIGTERM');
  assert.equal(running.alive(), false);
});

test('contract process observes successful and unsuccessful exits', async context => {
  for (const code of [0, 7]) {
    const running = contractProcess(context, { binary: process.execPath, arguments: ['-e', 'process.exit(' + code + ')'] }, [], process.cwd());
    assert.equal(await running.ended, code);
    assert.equal(running.alive(), false);
    await running.close();
  }
});

test('owned cleanup honors the declared operation budget without an unconditional delay', async context => {
  const running = contractProcess(context, { binary: process.execPath, arguments: ['-e', 'process.on("SIGTERM", () => {}); process.on("SIGUSR2", () => process.exit(0)); console.log("ready"); setInterval(() => {}, 60000);'] }, [], process.cwd());
  await observe(() => running.output().includes('ready'), 'Controlled cleanup child must be ready');
  const signals: string[] = [], kill = process.kill.bind(process);
  context.mock.method(process, 'kill', (pid: number, signal: NodeJS.Signals = 'SIGTERM') => { signals.push(signal); return kill(pid, signal); });
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const closing = running.close(120000);
  context.mock.timers.tick(10000);
  assert.deepEqual(signals, ['SIGTERM'], 'The fixture must not kill an owner before its stop/removal operations can finish');
  running.child.kill('SIGUSR2');
  await closing; assert.equal(await running.ended, 0);
});

test('owned cleanup still forcibly terminates a process that exceeds its finite deadline', async context => {
  const running = contractProcess(context, { binary: process.execPath, arguments: ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 60000);'] }, [], process.cwd());
  await observe(() => running.output().includes('ready'), 'Unresponsive cleanup child must be ready');
  for (const milliseconds of [0, Infinity, 120001]) assert.throws(() => running.close(milliseconds), /finite owned-process/u);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const closing = running.close(100);
  context.mock.timers.tick(100);
  await closing; assert.equal(running.child.signalCode, 'SIGKILL'); assert.equal(await running.ended, null);
});
