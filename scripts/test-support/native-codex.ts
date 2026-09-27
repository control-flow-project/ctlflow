import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { createConnection } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from '../../skills/conduit-chat/scripts/lib.ts';
import { until } from './listener.ts';

type Rpc = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown> };

export async function nativeCodex(context: TestContext) {
  const binary = process.env.CROSSFIRE_TEST_CODEX ?? 'codex';
  console.log(execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim());
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-native-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'); mkdirSync(home);
  const originalHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  context.after(() => {
    if (originalHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalHome;
  });
  const workspace = join(directory, 'workspace'); mkdirSync(workspace);
  const requests: unknown[] = [];
  let held: ServerResponse | undefined;
  let holdNext = true;
  let toolNext = false;
  let toolCalls = 0;
  function finish(response: ServerResponse, tool = false): void {
    const item = tool
      ? { type: 'function_call', id: 'fc-probe', call_id: 'call-probe', name: 'fixture_probe', arguments: '{}' }
      : { type: 'message', id: 'message-' + requests.length, role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'Fixture complete.' }] };
    response.write('event: response.output_item.done\ndata: ' + JSON.stringify({ type: 'response.output_item.done', output_index: 0, item }) + '\n\n');
    response.end('event: response.completed\ndata: ' + JSON.stringify({ type: 'response.completed',
      response: { id: 'response-' + requests.length, output: [item], status: 'completed',
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }) + '\n\n');
  }
  const model = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/responses') {
        response.writeHead(404); response.end('{}'); return;
      }
      requests.push(JSON.parse((await collect(request, 8 * 1024 * 1024)).toString()));
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      response.write('event: response.created\ndata: ' + JSON.stringify({ type: 'response.created', response: { id: 'response-' + requests.length } }) + '\n\n');
      if (holdNext) { holdNext = false; held = response; }
      else { const tool = toolNext; toolNext = false; finish(response, tool); }
    } catch (error) { response.destroy(error instanceof Error ? error : new Error(String(error))); }
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>(resolve => { model.closeAllConnections(); model.close(() => resolve()); }));
  const address = model.address(); assert(address && typeof address === 'object');
  writeFileSync(join(home, 'config.toml'), `model = "fixture-model"
model_provider = "fixture"
approval_policy = "never"
[model_providers.fixture]
name = "Local verification fixture"
base_url = "http://127.0.0.1:${address.port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
`);
  const nativeSocket = join(directory, 'native.sock');
  const server = spawn(binary, ['app-server', '--listen', 'unix://' + nativeSocket], {
    env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, RUST_LOG: 'error' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  server.stderr.on('data', chunk => { errors = (errors + String(chunk)).slice(-16000); });
  const serverDone = once(server, 'close');
  context.after(async () => { server.kill('SIGTERM'); await serverDone; });
  await until(() => existsSync(nativeSocket) || server.exitCode !== null, 'Native socket unavailable');
  assert.equal(server.exitCode, null, errors);
  const owner = new WebSocket('ws://localhost/', { createConnection: () => createConnection(nativeSocket), perMessageDeflate: false });
  await once(owner, 'open');
  context.after(() => owner.terminate());
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const notifications: { method: string; params: Record<string, unknown> }[] = [];
  let sequence = 0;
  owner.on('message', data => {
    const message = JSON.parse(data.toString());
    if (message.method) {
      notifications.push(message);
      if (message.method === 'item/tool/call') {
        toolCalls++;
        owner.send(JSON.stringify({ id: message.id, result: {
          contentItems: [{ type: 'inputText', text: 'fixture-output' }], success: true,
        } }));
      }
    } else {
      const entry = pending.get(message.id);
      if (entry) {
        clearTimeout(entry.timer); pending.delete(message.id);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
      }
    }
  });
  const call = (method: string, params: unknown): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out: ' + errors)); }, 10_000);
    pending.set(id, { resolve, reject, timer });
    owner.send(JSON.stringify({ id, method, params }));
  });
  context.after(() => { for (const request of pending.values()) clearTimeout(request.timer); });
  await call('initialize', { clientInfo: { name: 'crossfire-verification', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  owner.send(JSON.stringify({ method: 'initialized' }));
  const started = await call('thread/start', { cwd: workspace,
    dynamicTools: [{ name: 'fixture_probe', description: 'Inert test probe', inputSchema: { type: 'object', properties: {} } }] });
  const thread = started.thread as { id: string };

  const control = createServer();
  const wire = new WebSocketServer({ noServer: true });
  const relayRequests: Rpc[] = [];
  const relayNotifications: Rpc[] = [];
  const historyQueries: { method: string; params: unknown; result: unknown }[] = [];
  const acknowledgements: { params: Record<string, unknown>; turn: { id: string } }[] = [];
  const socketPath = join(directory, 'observed.sock');
  control.on('upgrade', (request, socket, head) => {
    const upstream = new WebSocket('ws://localhost/', { createConnection: () => createConnection(nativeSocket), perMessageDeflate: false });
    upstream.on('error', () => socket.destroy());
    upstream.once('open', () => wire.handleUpgrade(request, socket, head, client => {
      const submissions = new Map<number | string, Rpc>();
      client.on('message', data => {
        const message = JSON.parse(data.toString()) as Rpc;
        relayRequests.push(message);
        if (message.id !== undefined && message.method) submissions.set(message.id, message);
        upstream.send(data.toString());
      });
      upstream.on('message', data => {
        const message = JSON.parse(data.toString()) as Rpc;
        if (message.method) relayNotifications.push(message);
        const submission = message.id === undefined || message.method ? undefined : submissions.get(message.id);
        if (submission && message.result) {
          if (submission.method === 'turn/start') acknowledgements.push({ params: submission.params!, turn: message.result.turn as { id: string } });
          if (submission.method?.endsWith('/list')) historyQueries.push({ method: submission.method, params: submission.params, result: message.result });
          submissions.delete(message.id!);
        }
        client.send(data.toString());
      });
      client.on('close', () => upstream.terminate());
      client.on('error', () => upstream.terminate());
      upstream.on('close', () => client.terminate());
    }));
  });
  await new Promise<void>(resolve => control.listen(socketPath, resolve));
  context.after(() => new Promise<void>(resolve => {
    for (const client of wire.clients) client.terminate();
    wire.close();
    control.close(() => resolve());
  }));
  return {
    options: { thread: thread.id, workspace, binary, socket: socketPath, timeoutMs: 10_000, pollMs: 100 },
    workspace, thread, call, requests, notifications, relayRequests, relayNotifications, historyQueries,
    acknowledgements: () => acknowledgements,
    completed: () => notifications.filter(event => event.method === 'turn/completed').length,
    held: () => held,
    hold: () => { held = undefined; holdNext = true; },
    finish: () => { assert(held); finish(held); held = undefined; },
    tool: () => { toolNext = true; },
    toolCalls: () => toolCalls,
  };
}
