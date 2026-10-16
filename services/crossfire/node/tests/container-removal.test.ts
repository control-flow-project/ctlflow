import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ownedDocker, removeContainer } from '../apps/server/src/container-lifecycle.js';
import { captureDocker, dockerCaptureTimeout } from '../apps/server/src/container-commands.js';
import { setImmediate as nextObservation } from 'node:timers/promises';

test('Docker lifecycle mutations and metadata probes use their canonical finite budgets', () => {
  for (const command of ['create', 'stop', 'rm']) assert.equal(dockerCaptureTimeout([command, 'fixture']), 120000);
  for (const args of [['info'], ['image', 'inspect'], ['container', 'ls'], ['container', 'inspect']]) assert.equal(dockerCaptureTimeout(args), 30000);
});

test('Docker capture preserves a Unicode scalar split across separately observed pipe chunks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-docker-utf8-')), previous = process.env.PATH;
  const emitted = join(directory, 'emitted'), acknowledgment = join(directory, 'acknowledgment'), cancellation = new AbortController();
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(5000)]);
  let pending: ReturnType<typeof captureDocker> | undefined;
  writeFileSync(join(directory, 'docker'), '#!' + process.execPath + '\n' + `
import { watch, writeFileSync, existsSync } from 'node:fs';
let delivered = false;
const waiting = watch(${JSON.stringify(directory)}, () => {
  if (!delivered && existsSync(${JSON.stringify(acknowledgment)})) { delivered = true; waiting.close(); process.stdout.write(Buffer.from([0x9a, 0x80])); }
});
process.stdout.write(Buffer.from([0xf0, 0x9f])); writeFileSync(${JSON.stringify(emitted)}, 'ready');
`, { mode: 0o700 });
  try {
    process.env.PATH = directory; pending = captureDocker(['image', 'inspect'], signal);
    while (!existsSync(emitted)) { signal.throwIfAborted(); await nextObservation(); }
    await nextObservation(); await nextObservation(); writeFileSync(acknowledgment, 'continue');
    const captured = await pending; assert.equal(captured.code, 0); assert.equal(captured.output, '🚀');
  } finally {
    cancellation.abort(); await pending?.catch(() => undefined);
    if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Docker capture rejects malformed, truncated and oversized output instead of silently replacing bytes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-docker-output-')), previous = process.env.PATH;
  try {
    process.env.PATH = directory;
    for (const [expression, message] of [['Buffer.from([255])', /UTF-8/u], ['Buffer.from([0xf0, 0x9f])', /UTF-8/u], ['Buffer.alloc(65537, 97)', /output bound/u]] as const) {
      writeFileSync(join(directory, 'docker'), '#!' + process.execPath + '\nprocess.stdout.write(' + expression + ');\n', { mode: 0o700 });
      await assert.rejects(captureDocker(['image', 'inspect'], AbortSignal.timeout(5000)), message);
    }
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; rmSync(directory, { recursive: true, force: true }); }
});

test('owned removal observes completion without competing with an existing deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-removal-')), previous = process.env.PATH;
  const identity = 'a'.repeat(64), state = join(directory, 'state.json'), calls = join(directory, 'calls.json');
  writeFileSync(join(directory, 'docker'), '#!' + process.execPath + '\n' + `
import { readFileSync, writeFileSync, watch } from 'node:fs';
const path = ${JSON.stringify(state)}, calls = ${JSON.stringify(calls)}, value = JSON.parse(readFileSync(path, 'utf8')), args = process.argv.slice(2);
const recorded = JSON.parse(readFileSync(calls, 'utf8')); recorded.push(args); writeFileSync(calls, JSON.stringify(recorded));
if (args[0] === 'create') console.log(${JSON.stringify(identity)});
else if (args[0] === 'start') {
  if (value.awaitStop) {
    let ended = false;
    const waiting = watch(${JSON.stringify(directory)}, () => {
      if (ended) return;
      try { if (JSON.parse(readFileSync(path, 'utf8')).phase === 'running') return; } catch { return; }
      ended = true; waiting.close();
    });
    writeFileSync(${JSON.stringify(join(directory, 'attached'))}, 'ready');
  } else { console.error('primary operation failed'); process.exitCode = 17; }
}
else if (args[0] === 'stop') value.phase = 'exited';
else if (args[0] === 'rm') { if (value.denied) { console.error('permission denied'); process.exitCode = 1; } else { value.phase = 'removing'; if (value.inProgress) process.exitCode = 1; } }
else if (args[1] === 'ls') { if (value.phase === 'removing' && ++value.observations > 2) value.phase = 'missing'; if (value.phase !== 'missing') console.log(${JSON.stringify(identity)}); }
else if (args[1] === 'inspect') console.log(value.phase);
writeFileSync(path, JSON.stringify(value));
`, { mode: 0o700 });
  try {
    process.env.PATH = directory;
    for (const phase of ['missing', 'removing', 'running']) for (const inProgress of [false, true]) {
      writeFileSync(state, JSON.stringify({ phase, inProgress, observations: 0 })); writeFileSync(calls, '[]');
      await removeContainer(identity);
      const recorded = JSON.parse(readFileSync(calls, 'utf8')) as string[][];
      assert.equal(recorded.filter(args => args[0] === 'rm').length, phase === 'running' ? 1 : 0);
      assert.equal(recorded.filter(args => args[0] === 'stop').length, phase === 'running' ? 1 : 0);
      assert.equal((JSON.parse(readFileSync(state, 'utf8')) as { phase: string }).phase, 'missing');
    }
    writeFileSync(state, JSON.stringify({ phase: 'running', awaitStop: true, observations: 0 })); writeFileSync(calls, '[]');
    const cancellation = new AbortController(), halted = ownedDocker(['run', '--name', 'fixture'], cancellation.signal);
    try {
      const deadline = performance.now() + 5000;
      while (!existsSync(join(directory, 'attached'))) { assert(performance.now() < deadline, 'Native attachment must become ready'); await nextObservation(); }
      cancellation.abort(); await halted;
      const recorded = JSON.parse(readFileSync(calls, 'utf8')) as string[][];
      assert.equal(recorded.filter(args => args[0] === 'stop').length, 1, 'Cancellation delegates to the single stop/removal owner');
      assert.equal(recorded.filter(args => args[0] === 'rm').length, 1);
    } finally { cancellation.abort(); await halted; }
    writeFileSync(state, JSON.stringify({ phase: 'running', denied: true, observations: 0 })); writeFileSync(calls, '[]');
    await assert.rejects(removeContainer(identity), /permission denied/u);
    await assert.rejects(ownedDocker(['run', '--name', 'fixture'], new AbortController().signal), error => error instanceof AggregateError
      && error.errors.length === 2 && error.errors[0] instanceof Error && /primary operation failed/u.test(error.errors[0].message)
      && error.errors[1] instanceof Error && /permission denied/u.test(error.errors[1].message));
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(removeContainer(identity, cancelled.signal), { name: 'AbortError' });
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; rmSync(directory, { recursive: true, force: true }); }
});
