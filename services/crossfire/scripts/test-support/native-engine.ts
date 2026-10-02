import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { codexProtocol, type NativeEvent } from '@crossfire/adapter-codex/protocol';
import type { nativeProvider } from './native-provider.js';
import { setTimeout as delay } from 'node:timers/promises';

export async function materialize(engine: Pick<Awaited<ReturnType<typeof nativeEngine>>, 'session' | 'call' | 'notifications'>, provider: Awaited<ReturnType<typeof nativeProvider>>) {
  await engine.call('turn/start', { threadId: engine.session, input: [{ type: 'text', text: 'Human opens this fixture session.', text_elements: [] }] });
  const deadline = Date.now() + 10_000;
  while (!provider.held()) { if (Date.now() > deadline) throw new Error('Initial native input timed out'); await delay(10); }
  provider.finish();
  while (!engine.notifications.some(notice => notice.method === 'turn/completed')) { if (Date.now() > deadline) throw new Error('Initial native completion timed out'); await delay(10); }
  engine.notifications.length = 0;
  provider.requests.length = 0;
  provider.hold();
}

export async function nativeEngine(scope: TestContext, home: string, workspace: string, arguments_: string[] = []) {
  const token = randomBytes(32).toString('hex');
  const tokenFile = join(home, 'token');
  const connectionFile = join(home, 'connection.json');
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const child = spawn(process.env.CROSSFIRE_TEST_CODEX ?? 'codex', ['app-server', '--listen', 'ws://127.0.0.1:0',
    '--ws-auth', 'capability-token', '--ws-token-file', tokenFile, ...arguments_], {
    cwd: workspace, env: { ...process.env, HOME: home, CODEX_HOME: home, RUNCODEX_CONNECTION_FILE: connectionFile }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  const ended = once(child, 'close');
  const terminate = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; } };
  cleanup(scope, async () => { terminate('SIGTERM'); const timer = setTimeout(() => terminate('SIGKILL'), 3000); try { await ended; } finally { clearTimeout(timer); terminate('SIGKILL'); } });
  const endpoint = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Native WS readiness timed out: ' + output)), 15_000);
    const inspect = (data: Buffer) => {
      output = (output + data.toString()).slice(-64_000);
      const found = /^\s*listening on: (ws:\/\/127\.0\.0\.1:\d+)\s*$/mu.exec(output);
      if (found) { clearTimeout(timer); resolve(found[1]!); }
    };
    child.stdout.on('data', inspect); child.stderr.on('data', inspect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', () => { clearTimeout(timer); reject(new Error('Native fixture closed: ' + output)); });
  });
  const notifications: NativeEvent[] = [];
  writeFileSync(connectionFile, JSON.stringify({ version: 1, endpoint, tokenFile: 'token' }), { mode: 0o600 });
  const controller = new AbortController();
  const protocol = codexProtocol({ endpoint, token, timeoutMs: 10_000, event: notice => notifications.push(notice),
    approval: async () => { throw new Error('Unexpected approval on fixture owner connection'); },
  }, controller.signal);
  cleanup(scope, async () => { controller.abort(); await protocol.closed; });
  const call = async (method: string, params: unknown) => await protocol.request(method, params) as Record<string, unknown>;
  await call('initialize', { clientInfo: { name: 'crossfire-native-fixture', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  protocol.notify('initialized');
  const started = await call('thread/start', { cwd: workspace });
  const thread = started.thread as { id: string; cwd: string; model: string; reasoningEffort: string };
  assert.equal(typeof thread.id, 'string');
  return { endpoint, token, workspace, session: thread.id, receiptFile: join(home, 'receipt.json'), thread, call, notifications, child, ended };
}
