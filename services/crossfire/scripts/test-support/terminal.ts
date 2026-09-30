import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';

export function openTerminal(scope: TestContext, command: string, environment: NodeJS.ProcessEnv) {
  const child = spawn('/usr/bin/script', ['--quiet', '--return', '--flush', '--command', 'stty cols 110 rows 35; ' + command, '/dev/null'],
    { env: { ...environment, TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let updatedAt = Date.now();
  child.stdout.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-1024 * 1024);
    updatedAt = Date.now();
    if (chunk.includes('\x1b[6n')) child.stdin.write('\x1b[1;1R');
  });
  child.stderr.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-1024 * 1024); });
  const ended = once(child, 'close');
  scope.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await ended; });
  async function until(predicate: (output: string) => boolean) {
    const deadline = Date.now() + 20000;
    while (!predicate(output) || Date.now() - updatedAt < 100) {
      assert.equal(child.exitCode, null, output);
      assert.equal(child.signalCode, null, output);
      assert(Date.now() < deadline, 'Native terminal observation timed out: ' + output);
      await delay(30);
    }
  }
  async function quit() {
    child.stdin.write('/quit');
    await delay(150);
    child.stdin.write('\r');
    const deadline = Date.now() + 10000;
    while (child.exitCode === null && child.signalCode === null) { assert(Date.now() < deadline, output); await delay(30); }
    const [code] = await ended; assert.equal(code, 0, output);
  }
  return { until, quit, write: (value: string) => child.stdin.write(value), output: () => output };
}
