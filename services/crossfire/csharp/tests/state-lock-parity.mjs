import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireFileLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { verifyTestResources } from '../../../../scripts/test-resources.mjs';

const [native, managed, dotnet] = process.argv.slice(2);
assert(native && managed && dotnet && process.argv.length === 5, 'Both C# outputs are mandatory');
verifyTestResources();
const directory = mkdtempSync(join(tmpdir(), 'crossfire-state-lock-'));
const file = join(directory, 'owner');
const owners = new Set();
async function command(nativeMode, mode) {
  const child = spawn(nativeMode ? native : dotnet, [...(nativeMode ? [] : [managed]), '--state-lock', mode, file], { stdio: ['pipe', 'pipe', 'pipe'] });
  owners.add(child);
  child.stdin.on('error', () => {});
  let output = '', errors = '';
  child.stderr.on('data', bytes => { errors = (errors + bytes).slice(-4096); });
  const ended = once(child, 'exit');
  const result = await new Promise((complete, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Ownership check timed out')); }, 10000);
    child.stdout.on('data', bytes => {
      output = (output + bytes).slice(-4096);
      if (output.includes('\n')) { clearTimeout(timeout); complete(JSON.parse(output.split('\n')[0])); }
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); if (!output.includes('\n')) reject(new Error('Ownership check failed: ' + code + ' ' + errors)); });
  });
  return { child, ended, result };
}
async function close(owner, forced = false) {
  if (forced) owner.child.kill('SIGKILL'); else owner.child.stdin.end('\n');
  await owner.ended; owners.delete(owner.child);
}
try {
  for (const nativeMode of [false, true]) {
    const release = acquireFileLock(file);
    try {
      const contender = await command(nativeMode, 'probe');
      assert.equal(contender.result.owned, false, 'C# must refuse Node-owned state immediately'); await close(contender);
    } finally { release(); }
    for (const forced of [false, true]) {
      const owner = await command(nativeMode, 'hold'); assert.equal(owner.result.owned, true);
      assert.throws(() => acquireFileLock(file), /already|held|locked|owns|process/iu, 'Node cannot acquire a C# owner');
      const contender = await command(!nativeMode, 'probe'); assert.equal(contender.result.owned, false, 'managed and AOT ownership is mutually exclusive'); await close(contender);
      await close(owner, forced);
      const reacquired = acquireFileLock(file); reacquired();
      const next = await command(!nativeMode, 'probe'); assert.equal(next.result.owned, true, 'OS releases ownership after normal shutdown or process death'); await close(next);
    }
  }
  console.log(JSON.stringify({ status: 'passed', directions: ['Node→managed', 'Node→AOT', 'managed→Node', 'AOT→Node', 'managed→AOT', 'AOT→managed'], forcedExit: true }));
} finally {
  for (const child of owners) if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended.catch(() => {}); }
  rmSync(directory, { recursive: true });
}
