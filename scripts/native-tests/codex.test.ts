import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { createConnection } from 'node:net';
import WebSocket from 'ws';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from '../../skills/conduit-chat/scripts/lib.ts';
import { connectCodex } from '../../skills/conduit-chat/scripts/codex.ts';
import { listen } from '../../skills/conduit-chat/scripts/listen.ts';
import { matrixFixture, message, ROOM, until } from '../test-support/listener.ts';

test('installed Codex delivers idle and active input to one thread while its original client retains control', { timeout: 60_000 }, async t => {
  const binary = process.env.CROSSFIRE_TEST_CODEX ?? 'codex';
  console.log(execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim());
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-native-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'); mkdirSync(home);
  const originalHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  t.after(() => {
    if (originalHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalHome;
  });
  const workspace = join(directory, 'workspace'); mkdirSync(workspace);
  const requests: unknown[] = [];
  let held: ServerResponse | undefined;
  let toolNext = false;
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
      if (requests.length === 1) held = response;
      else { const tool = toolNext; toolNext = false; finish(response, tool); }
    } catch (error) { response.destroy(error instanceof Error ? error : new Error(String(error))); }
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { model.closeAllConnections(); model.close(() => resolve()); }));
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
  const socketPath = join(directory, 'server.sock');
  const server = spawn(binary, ['app-server', '--listen', 'unix://' + socketPath], {
    env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, RUST_LOG: 'error' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  server.stderr.on('data', chunk => { errors = (errors + String(chunk)).slice(-16000); });
  const serverDone = once(server, 'close');
  t.after(async () => { server.kill('SIGTERM'); await serverDone; });
  await until(() => existsSync(socketPath) || server.exitCode !== null, 'Native socket unavailable: ' + errors);
  assert.equal(server.exitCode, null, errors);
  const owner = new WebSocket('ws://localhost/', { createConnection: () => createConnection(socketPath),
    perMessageDeflate: false });
  await once(owner, 'open');
  t.after(() => owner.terminate());
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const notifications: { method: string; params: Record<string, unknown> }[] = [];
  let sequence = 0, toolCalls = 0;
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
  t.after(() => { for (const request of pending.values()) clearTimeout(request.timer); });
  await call('initialize', { clientInfo: { name: 'crossfire-verification', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  owner.send(JSON.stringify({ method: 'initialized' }));
  const started = await call('thread/start', { cwd: workspace, ephemeral: true,
    dynamicTools: [{ name: 'fixture_probe', description: 'Inert test probe', inputSchema: { type: 'object', properties: {} } }] });
  const thread = started.thread as { id: string };
  const adapter = await connectCodex({ thread: thread.id, workspace, binary, socket: socketPath, timeoutMs: 10_000 }, new AbortController().signal);
  t.after(adapter.close);
  await adapter.deliver('idle fixture input', 'fixture-idle');
  await until(() => held !== undefined, 'No request reached the local mock model: ' + errors);
  const active = await call('thread/read', { threadId: thread.id, includeTurns: false });
  assert.equal((active.thread as { status: { type: string } }).status.type, 'active');
  await adapter.deliver('busy fixture input', 'fixture-busy');
  assert.equal(notifications.filter(event => event.method === 'turn/started').length, 1);
  finish(held!);
  await until(() => notifications.some(event => event.method === 'turn/completed'), 'Native turn did not finish: ' + errors);
  assert(requests.some(request => JSON.stringify(request).includes('idle fixture input')));
  assert(requests.some(request => JSON.stringify(request).includes('busy fixture input')));
  const userItems = notifications.filter(event => event.method === 'item/started' && JSON.stringify(event.params).includes('userMessage'));
  assert(userItems.some(event => JSON.stringify(event).includes('idle fixture input')));
  assert(userItems.some(event => JSON.stringify(event).includes('busy fixture input')));
  const idle = await call('thread/read', { threadId: thread.id, includeTurns: false });
  assert.equal((idle.thread as { status: { type: string } }).status.type, 'idle');
  const completed = () => notifications.filter(event => event.method === 'turn/completed').length;
  const beforeTool = completed();
  toolNext = true;
  await adapter.deliver('tool routing fixture', 'fixture-tool');
  await until(() => toolCalls === 1 && completed() > beforeTool, 'Original client did not retain tool control: ' + errors);
  assert(requests.some(request => JSON.stringify(request).includes('fixture-output')));
  adapter.close();
  const beforeManual = completed();
  await call('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'owner still controls session', text_elements: [] }] });
  await until(() => completed() > beforeManual);
  assert.equal((await call('thread/read', { threadId: thread.id, includeTurns: false })).thread instanceof Object, true);
  const matrix = await matrixFixture(t, workspace);
  const stop = new AbortController();
  const receiving = listen({ ...matrix, limit: 50, pollMs: 100,
    codex: { thread: thread.id, workspace, binary, socket: socketPath, timeoutMs: 10_000 } }, stop.signal).catch(error => error);
  t.after(async () => { stop.abort(new Error('verification complete')); await receiving; });
  await until(() => matrix.waiting() === 1);
  const beforeMessage = completed();
  matrix.add(ROOM, message('$native-integration', undefined, 'Matrix to native Codex fixture'));
  await until(() => completed() > beforeMessage);
  assert(requests.some(request => JSON.stringify(request).includes('Matrix to native Codex fixture')));
  stop.abort(new Error('verification complete'));
  assert.match(String(await receiving), /verification complete/);
  assert(notifications.every(event => !JSON.stringify(event).includes('api.openai.com')));
  console.log('PASS idle start, active steering, original-client control, relay disconnect, and Matrix-to-native delivery.');
});
