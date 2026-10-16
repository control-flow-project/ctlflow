import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeContainer } from '../apps/server/src/container-lifecycle.js';

test('owned removal observes completion without competing with an existing deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-removal-')), previous = process.env.PATH;
  const identity = 'a'.repeat(64), state = join(directory, 'state.json'), calls = join(directory, 'calls.json');
  writeFileSync(join(directory, 'docker'), '#!' + process.execPath + '\n' + `
import { readFileSync, writeFileSync } from 'node:fs';
const path = ${JSON.stringify(state)}, calls = ${JSON.stringify(calls)}, value = JSON.parse(readFileSync(path, 'utf8')), args = process.argv.slice(2);
const recorded = JSON.parse(readFileSync(calls, 'utf8')); recorded.push(args); writeFileSync(calls, JSON.stringify(recorded));
if (args[0] === 'stop') value.phase = 'exited';
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
    writeFileSync(state, JSON.stringify({ phase: 'running', denied: true, observations: 0 })); writeFileSync(calls, '[]');
    await assert.rejects(removeContainer(identity), /permission denied/u);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(removeContainer(identity, cancelled.signal), { name: 'AbortError' });
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; rmSync(directory, { recursive: true, force: true }); }
});
