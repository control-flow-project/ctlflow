import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { collect } from '@ctlflow/crossfire-adapter-matrix/http';
import type { TestContext } from 'node:test';

export async function claudeProvider(scope: TestContext, command?: string, holdRequest?: number) {
  const requests: unknown[] = [];
  let nextCommand = command;
  let release: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.startsWith('/v1/messages')) { response.writeHead(404).end('{}'); return; }
    const number = requests.push(JSON.parse((await collect(request, 8 * 1024 * 1024)).toString()) as unknown);
    if (number === holdRequest) await new Promise<void>(resolve => { release = resolve; });
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const toolCommand = nextCommand; nextCommand = undefined;
    const tool = toolCommand !== undefined;
    const records = [
      ['message_start', { type: 'message_start', message: { id: 'fixture-' + number, type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: tool ? { type: 'tool_use', id: 'native-tool-' + number, name: 'Bash', input: {} } : { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify({ command: toolCommand, description: 'Run the fixture native tool' }) } : { type: 'text_delta', text: 'Fixture complete.' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    for (const [name, value] of records) response.write('event: ' + name + '\ndata: ' + JSON.stringify(value) + '\n\n');
    response.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Invalid provider fixture address');
  cleanup(scope, async () => { release?.(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { base: 'http://127.0.0.1:' + address.port, requests, release: () => release?.(), tool: (command: string) => { nextCommand = command; } };
}
