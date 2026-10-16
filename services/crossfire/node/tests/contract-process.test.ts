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
