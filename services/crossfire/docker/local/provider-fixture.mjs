import { createServer } from 'node:http';

let count = 0;
createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/responses') {
    response.writeHead(404).end('{}'); return;
  }
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) { response.writeHead(413).end(); return; }
  }
  const id = 'local-fixture-' + ++count;
  const item = { type: 'message', id: 'message-' + count, role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'Local container verification complete.' }] };
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const event of [
    { type: 'response.created', response: { id } },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id, output: [item], status: 'completed',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ]) response.write('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n');
  response.end();
}).listen(19000, '127.0.0.1', () => console.log('Local inert provider ready'));
