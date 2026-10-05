import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { codexProtocol } from '@ctlflow/crossfire-adapter-codex/protocol';
import { connectCodex } from '@ctlflow/crossfire-adapter-codex/connection';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { materialize } from '../scripts/test-support/native-engine.js';
import type { NativeEvent } from '@ctlflow/crossfire-adapter-codex/protocol';
test('stock Codex native Unix transport connects the exact fixture-owned session without discovery or model input', { timeout: 30000 }, async scope => {
  const home = mkdtempSync(join(tmpdir(), 'crossfire-unix-'));
  chmodSync(home, 0o700);
  const workspace = join(home, 'project'), control = join(home, 'app-server-control');
  mkdirSync(workspace, { mode: 0o700 }); mkdirSync(control, { mode: 0o700 });
  const socket = join(control, 'app-server-control.sock'), provider = await nativeProvider(scope, home);
  const child = spawn(process.env.CROSSFIRE_TEST_CODEX ?? 'codex', ['app-server', '--listen', 'unix://' + socket], { cwd: workspace,
    env: { ...process.env, CODEX_HOME: home, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stderr.on('data', part => { output = (output + String(part)).slice(-8000); });
  const ended = once(child, 'close');
  cleanup(scope, async () => { child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 3000); try { await ended; } finally { clearTimeout(timer); rmSync(home, { recursive: true, force: true }); } });
  const deadline = Date.now() + 10000;
  while (!existsSync(socket)) { if (Date.now() > deadline || child.exitCode !== null) throw new Error('Native Unix startup failed: ' + output); await delay(20); }
  const notices: NativeEvent[] = [];
  const stop = new AbortController(), owner = codexProtocol({ endpoint: 'unix://' + socket, token: '', timeoutMs: 5000, event: notice => notices.push(notice), approval: async () => { throw Error('Unexpected approval'); } }, stop.signal);
  cleanup(scope, async () => { stop.abort(); await owner.closed; });
  await owner.request('initialize', { clientInfo: { name: 'crossfire-unix-proof', version: '0.1.0' }, capabilities: { experimentalApi: true } }); owner.notify('initialized');
  const started = await owner.request('thread/start', { cwd: workspace }) as { thread: { id: string } };
  await materialize({ session: started.thread.id, call: async (method, params) => await owner.request(method, params) as Record<string, unknown>, notifications: notices }, provider);
  const connection = await connectCodex({ workspace, session: started.thread.id, endpoint: 'unix://' + socket, token: '', receiptFile: join(home, 'receipt.json'),
    pollMs: 100, hooks: { requestDecision: async () => { throw Error('Unexpected permission'); } } }, stop.signal);
  assert.equal((await connection.inspect()).busy, false);
  assert.equal(connection.sessionId, started.thread.id);
  assert.equal(provider.requests.length, 0);
  await connection.close();
});
