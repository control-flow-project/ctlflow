import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from '@ctlflow/crossfire-kernel/collect';
import { cleanup } from './cleanup.js';

export async function piProvider(scope: TestContext) {
  const home = mkdtempSync(join(tmpdir(), 'crossfire-pi-login-')), previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = home;
  writeFileSync(join(home, 'auth.json'), '{}', { mode: 0o600 });
  cleanup(scope, () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(home, { recursive: true, force: true }); });
  const requests: Record<string, unknown>[] = [];
  let holdNext = false, held: ServerResponse | undefined, tool: { name: string; arguments_: unknown } | undefined;
  function finish(response: ServerResponse, selected?: { name: string; arguments_: unknown }): void {
    const delta = selected ? { tool_calls: [{ index: 0, id: 'call-' + requests.length, type: 'function', function: { name: selected.name, arguments: JSON.stringify(selected.arguments_) } }] } : { content: 'Fixture complete.' };
    response.write('data: ' + JSON.stringify({ id: 'chat-' + requests.length, choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
    response.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: selected ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, prompt_tokens_details: { cached_tokens: 2 } } }) + '\n\n');
    response.end('data: [DONE]\n\n');
  }
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions'); assert.equal(request.method, 'POST');
      requests.push(JSON.parse((await collect(request, 8 * 1024 * 1024)).toString('utf8')) as Record<string, unknown>);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: ' + JSON.stringify({ id: 'chat-' + requests.length, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }) + '\n\n');
      if (holdNext) { holdNext = false; held = response; }
      else { const selected = tool; tool = undefined; finish(response, selected); }
    } catch (error) { response.destroy(error instanceof Error ? error : undefined); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup(scope, () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address !== 'string');
  writeFileSync(join(home, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: 'http://127.0.0.1:' + address.port + '/v1', api: 'openai-completions', apiKey: 'fixture',
    models: [{ id: 'fixture-model', name: 'Inert Pi fixture', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 },
      { id: 'plain-model', name: 'No reasoning fixture', reasoning: false }] } } }), { mode: 0o600 });
  return { home, requests, hold: () => { held = undefined; holdNext = true; }, held: () => held,
    finish: () => { assert(held); finish(held); held = undefined; }, tool: (name: string, arguments_: unknown) => { tool = { name, arguments_ }; } };
}
