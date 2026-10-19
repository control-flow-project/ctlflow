import { truncateUtf16 } from '@ctlflow/crossfire-kernel/text';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { collect } from '@ctlflow/crossfire-kernel/collect';
import type { HistoryQueries } from '@ctlflow/crossfire-agent-core/history-query';
import type { ListenerTest } from '@ctlflow/crossfire-agent-core/diagnostic';
import { failure } from '@ctlflow/crossfire-kernel/result';
import { listenerInput } from './listener-protocol.js';
import { createListenerBudget } from '@ctlflow/crossfire-agent-core/budget';

type BindingOptions = { cursorFile: string; release: string; binding: string; session: () => string; stop: () => void };
type Binding = BindingOptions & { secret: string; file: string; diagnose?: () => Promise<ListenerTest>; queries?: HistoryQueries };
export type ListenerHost = Awaited<ReturnType<typeof createListenerHost>>;

export async function createListenerHost() {
  const bindings = new Map<string, Binding>();
  const budget = createListenerBudget();
  let inFlight = 0, closing = false;
  const server = createServer(async (request, response) => {
    response.setHeader('Connection', 'close');
    response.setHeader('Content-Type', 'application/json');
    const matched = /^\/bindings\/([a-zA-Z0-9._-]{1,255})\/control$/u.exec(request.url ?? '');
    const binding = matched ? bindings.get(matched[1]!) : undefined;
    const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined;
    if (closing || request.method !== 'POST' || !binding || request.headers.origin || !token || !/^[a-f0-9]{64}$/u.test(token)
      || !timingSafeEqual(Buffer.from(token), Buffer.from(binding.secret))) { response.writeHead(403).end(); return; }
    if (inFlight >= 16) { response.writeHead(429).end(JSON.stringify({ error: 'Listener host request capacity reached' })); return; }
    inFlight++;
    let queryAction = false;
    try {
      const parsed = listenerInput(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await collect(request, 65536))) as unknown);
      if (!parsed.ok) { response.writeHead(400).end(JSON.stringify({ error: parsed.error.message })); return; }
      const input = parsed.value;
      queryAction = input.action === 'read' || input.action === 'acknowledge';
      const status = { release: binding.release, binding: binding.binding, session: binding.session(), ready: !!binding.diagnose };
      if (input.action === 'read' || input.action === 'acknowledge') {
        if (!binding.queries) { response.writeHead(409).end(JSON.stringify(failure('unavailable', 'Listener is not ready'))); return; }
        const result = input.action === 'read' ? await binding.queries.read(input.input) : await binding.queries.acknowledge(input.queryId);
        const body = JSON.stringify(result);
        if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('Listener query result exceeds its resource bound');
        response.writeHead(result.ok ? 200 : 409).end(body); return;
      }
      if (input.action === 'stop') binding.stop();
      if (input.action === 'test') {
        if (!binding.diagnose) throw new Error('Listener is not ready');
        response.end(JSON.stringify({ ...status, test: await binding.diagnose() }));
      } else response.end(JSON.stringify(status));
    } catch (error) {
      const message = error instanceof Error ? truncateUtf16(error.message, 1024) : 'Listener control failed';
      response.writeHead(400).end(JSON.stringify(queryAction ? failure('unavailable', message) : { error: message }));
    } finally { inFlight--; }
  });
  server.requestTimeout = 45000;
  server.headersTimeout = 10000;
  server.maxConnections = 32;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Cannot open private listener host');
  return {
    budget,
    bind(options: BindingOptions) {
      if (closing || bindings.has(options.binding) || bindings.size >= 10000 || !/^[a-zA-Z0-9._-]{1,255}$/u.test(options.binding)) throw new Error('Invalid or duplicate listener host binding');
      const binding: Binding = { ...options, secret: randomBytes(32).toString('hex'), file: join(dirname(options.cursorFile), 'listener.json') };
      writeJson(binding.file, { port: address.port, secret: binding.secret, binding: options.binding });
      bindings.set(options.binding, binding);
      return {
        ready(test: () => Promise<ListenerTest>, queries: HistoryQueries): void { binding.diagnose = test; binding.queries = queries; },
        close(): void {
          bindings.delete(options.binding); delete binding.diagnose; delete binding.queries;
          if (existsSync(binding.file)) unlinkSync(binding.file);
        },
      };
    },
    size: () => bindings.size,
    async close(): Promise<void> {
      closing = true;
      if (bindings.size) throw new Error('Close listener bindings before closing their host');
      server.closeIdleConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
