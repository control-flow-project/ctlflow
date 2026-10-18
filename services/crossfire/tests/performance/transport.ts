import { Agent, request } from 'node:https';
import { decodeResponse } from '@ctlflow/crossfire-contracts/rest/envelope';
import type { Parser } from '@ctlflow/crossfire-contracts/schema/validation';

export type PerformanceRequest = {
  path: string; method: string; status: number; output: Parser<unknown>; collection: boolean;
  headers: Record<string, string>; body?: unknown;
};
export type PerformanceResponse = { elapsedMs: number; failure: string | null };

export function performanceTransport(origin: string, signal: AbortSignal) {
  const agent = new Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 16 });
  return {
    close() { agent.destroy(); },
    call(input: PerformanceRequest): Promise<PerformanceResponse> {
      const started = performance.now(), url = new URL(input.path, origin);
      const bytes = input.body === undefined ? undefined : Buffer.from(JSON.stringify(input.body));
      return new Promise(resolve => {
        const complete = (failure: string | null) => resolve({ elapsedMs: performance.now() - started, failure });
        const outgoing = request(url, { agent, signal, method: input.method, headers: { Accept: 'application/json',
          ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': String(bytes.length) } : {}), ...input.headers } }, response => {
          const chunks: Buffer[] = []; let size = 0;
          response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 16777216) response.destroy(new Error('Performance response exceeds 16 MiB')); else chunks.push(chunk); });
          response.once('error', error => complete(error.message));
          response.once('end', () => {
            if (response.statusCode !== input.status) { complete(input.method + ' ' + url.pathname + ': HTTP ' + response.statusCode); return; }
            try {
              const result = decodeResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown, input.output, input.collection);
              complete(result.ok ? null : input.method + ' ' + url.pathname + ': invalid response contract');
            } catch { complete(input.method + ' ' + url.pathname + ': invalid response JSON'); }
          });
        });
        outgoing.setTimeout(15000, () => outgoing.destroy(new Error('Performance request exceeded 15 seconds')));
        outgoing.once('error', error => complete(error.message)); outgoing.end(bytes);
      });
    },
  };
}
