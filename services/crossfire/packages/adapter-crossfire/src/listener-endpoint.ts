import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeJson } from '@crossfire/adapter-filesystem/index';
import { collect } from '@crossfire/adapter-matrix/http';
import { historyRequest, type HistoryQueries } from '@crossfire/agent-core/history-query';
import type { ListenerTest } from '@crossfire/agent-core/diagnostic';
import { fields } from '@crossfire/contracts/validation';
import { failure } from '@crossfire/kernel/result';

export async function listenerEndpoint(options: { cursorFile: string; release: string; binding: string; session: () => string; stop: () => Promise<void> }) {
  const secret = randomBytes(32).toString('hex'), file = join(dirname(options.cursorFile), 'listener.json');
  let diagnose: (() => Promise<ListenerTest>) | undefined, queries: HistoryQueries | undefined;
  const server = createServer(async (request, response) => {
    response.setHeader('Connection', 'close');
    response.setHeader('Content-Type', 'application/json');
    const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined;
    if (request.method !== 'POST' || request.url !== '/control' || request.headers.origin || !token || token.length !== secret.length
      || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) { response.writeHead(403).end(); return; }
    let action: unknown;
    try {
      const input = fields(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await collect(request, 65536))) as unknown, ['action'], ['input', 'queryId']);
      if (!input.ok || !['status', 'stop', 'test', 'read', 'acknowledge'].includes(String(input.value.action))) throw new Error('Invalid listener control request');
      action = input.value.action;
      const allowed = input.value.action === 'read' ? ['action', 'input'] : input.value.action === 'acknowledge' ? ['action', 'queryId'] : ['action'];
      if (Object.keys(input.value).some(key => !allowed.includes(key))) throw new Error('Unknown listener action fields');
      if (input.value.action === 'stop') {
        response.once('finish', () => { void options.stop().catch(error => server.emit('error', error)); });
        response.end(JSON.stringify({ release: options.release, binding: options.binding, session: options.session(), ready: !!diagnose })); return;
      } else if (input.value.action === 'read') {
        const parsed = historyRequest(input.value.input);
        if (!parsed.ok || !queries) throw new Error(parsed.ok ? 'Listener is not ready' : parsed.error.message);
        const result = await queries.read(parsed.value);
        response.writeHead(result.ok ? 200 : 409).end(JSON.stringify(result)); return;
      } else if (input.value.action === 'acknowledge') {
        if (!queries || typeof input.value.queryId !== 'string') throw new Error('Invalid unread query acknowledgment');
        const result = await queries.acknowledge(input.value.queryId);
        response.writeHead(result.ok ? 200 : 409).end(JSON.stringify(result)); return;
      }
      const status = { release: options.release, binding: options.binding, session: options.session(), ready: !!diagnose };
      if (input.value.action === 'test') {
        if (!diagnose) throw new Error('Listener is not ready');
        response.end(JSON.stringify({ ...status, test: await diagnose() }));
      } else response.end(JSON.stringify(status));
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1024) : 'Listener control failed';
      response.writeHead(400).end(JSON.stringify(action === 'read' || action === 'acknowledge' ? failure('unavailable', message) : { error: message }));
    }
  });
  server.requestTimeout = 45000;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Cannot open private listener control');
  try { writeJson(file, { port: address.port, secret }); }
  catch (error) { await new Promise<void>(resolve => server.close(() => resolve())); throw error; }
  return { ready(test: () => Promise<ListenerTest>, receiver: HistoryQueries) { diagnose = test; queries = receiver; },
    async close() { diagnose = undefined; queries = undefined; server.closeIdleConnections(); await new Promise<void>(resolve => server.close(() => resolve())); if (existsSync(file)) unlinkSync(file); } };
}
