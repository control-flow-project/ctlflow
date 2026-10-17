import assert from 'node:assert/strict';
import { request } from 'node:http';
import { request as secureRequest } from 'node:https';
import { record } from './contract-process.js';

export type ContractReply = { status: number; body: unknown; headers: Record<string, string | string[] | undefined> };
export async function contractHttp(origin: string, method: string, path: string, body?: unknown, headers: Record<string, string | string[]> = {}, socket?: string, localAddress?: string): Promise<ContractReply> {
  const url = new URL(path, origin), bytes = body === undefined ? undefined : body instanceof Uint8Array ? Buffer.from(body) : typeof body === 'string' && headers['Content-Type'] === 'application/x-www-form-urlencoded' ? Buffer.from(body) : Buffer.from(JSON.stringify(body));
  return new Promise((resolveReply, reject) => {
    const outgoing = (url.protocol === 'https:' ? secureRequest : request)({ protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, family: 4,
      ...(socket ? { socketPath: socket } : {}), ...(localAddress ? { localAddress } : {}), agent: false, headers: { Host: url.host, Accept: 'application/json', ...(bytes ? { 'Content-Type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json', 'Content-Length': String(bytes.length) } : {}), ...headers } }, response => {
      const parts: Buffer[] = []; let length = 0;
      response.on('data', (bytes: Buffer) => { length += bytes.length; if (length > 16777216) { response.destroy(new Error('Contract response exceeded 16 MiB')); return; } parts.push(bytes); }); response.once('error', reject);
      response.once('end', () => { try { const value = Buffer.concat(parts).toString('utf8'); resolveReply({ status: response.statusCode ?? 0, headers: response.headers, body: response.headers['content-type']?.split(';')[0] === 'application/json' ? JSON.parse(value) as unknown : value }); } catch (error) { reject(error); } });
    }); outgoing.setTimeout(15000, () => outgoing.destroy(new Error('Contract HTTP deadline exceeded'))); outgoing.once('error', reject); outgoing.end(bytes);
  });
}
export function contractData(reply: ContractReply, status: number): Record<string, unknown> { assert.equal(reply.status, status, JSON.stringify(reply.body).slice(0, 1024)); return record(record(reply.body).data); }
export function contractError(reply: ContractReply, status: number, code: string): void { assert.equal(reply.status, status, JSON.stringify(reply.body).slice(0, 1024)); assert.equal(record(record(reply.body).error).code, code); }
