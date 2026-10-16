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
  const command = { binary: process.execPath, arguments: ['-e', 'process.exit(0)'] };
  for (const budget of [0, -1, NaN, 0.5, 2147483648]) assert.throws(() => contractProcess(context, command, [], process.cwd(), process.env, budget), /positive native shutdown/u);
  for (const code of [0, 7]) {
    const running = contractProcess(context, { binary: process.execPath, arguments: ['-e', 'process.exit(' + code + ')'] }, [], process.cwd(), process.env, 180000);
    assert.equal(await running.ended, code);
    assert.equal(running.alive(), false);
    await running.close();
  }
});
