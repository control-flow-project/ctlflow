import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createDaemonClient, operations } from '@ctlflow/fleet-daemon-client/client';

test('installed fleetd symlink starts the exact private daemon and stops normally', { timeout: 15000 }, async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleetd-installed-'));
  const installed = join(directory, 'fleetd'), root = join(directory, 'controller');
  symlinkSync(fileURLToPath(import.meta.resolve('@ctlflow/fleetd/executable')), installed);
  const child = spawn(process.execPath, [installed, '--root', root, '--name', 'installed-controller'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'close'); let output = '', errors = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { errors += String(chunk); });
  cleanup(scope, async () => { if (child.exitCode === null) child.kill('SIGTERM'); await ended; });
  const client = createDaemonClient(join(root, 'fleetd.sock'));
  const deadline = Date.now() + 10000;
  for (;;) {
    const result = await client.call(operations.status, {}, {});
    if (result.ok) { assert.equal(result.value.data.controller.name, 'installed-controller'); break; }
    assert.equal(child.exitCode, null, 'Installed daemon exited without starting: ' + output + errors);
    assert(Date.now() < deadline, 'Installed daemon did not publish its private endpoint');
    await delay(30);
  }
  assert.equal(JSON.parse(output.trim()).status, 'ready');
  child.kill('SIGTERM');
  assert.equal((await ended)[0], 0);
});
