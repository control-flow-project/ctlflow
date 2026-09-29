import { request as httpRequest } from 'node:http';
import type { Operation } from '@crossfire/contracts/rest/operation';
import { operationPath } from '@crossfire/contracts/rest/operation';
import { decodeResponse, decodeFailure, type Response } from '@crossfire/contracts/rest/envelope';
import { failure, type Result } from '@crossfire/kernel/result';
export { operations } from '@fleetd/contracts/api';

export function createDaemonClient(socketPath: string, signal?: AbortSignal) {
  async function call<Params extends Record<string, string>, Query, Input, Output>(operation: Operation<Params, Query, Input, Output>, params: Params, input: Input, query = new URLSearchParams()): Promise<Result<Response<Output>>> {
    const validParams = operation.params(params), validInput = operation.input(input), validQuery = operation.query(query);
    if (!validParams.ok) return validParams; if (!validInput.ok) return validInput; if (!validQuery.ok) return validQuery;
    if (signal?.aborted) return failure('unavailable', 'Daemon request cancelled');
    const content = operation.method === 'GET' ? undefined : JSON.stringify(validInput.value);
    if (content && Buffer.byteLength(content) > 1024 * 1024) return failure('body_too_large', 'Daemon request exceeds 1 MiB');
    return new Promise(resolve => {
      const request = httpRequest({ socketPath, method: operation.method, path: operationPath(operation.path, params) + (query.size ? '?' + query.toString() : ''),
        headers: { Host: 'localhost', ...(content ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(content) } : {}) },
        timeout: 120000, ...(signal ? { signal } : {}),
      }, response => {
        const buffers: Buffer[] = []; let length = 0;
        response.on('data', (buffer: Buffer) => {
          length += buffer.length;
          if (length > 16 * 1024 * 1024) { response.destroy(); resolve(failure('native', 'Daemon response exceeds 16 MiB')); return; }
          buffers.push(buffer);
        });
        response.once('error', () => resolve(failure('unavailable', 'Daemon response disconnected')));
        response.once('end', () => {
          try {
            const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(buffers)));
            resolve(response.statusCode === operation.status ? decodeResponse(value, operation.output, operation.collection)
              : response.statusCode && response.statusCode >= 400 ? decodeFailure(value) : failure('native', 'Unexpected daemon status'));
          } catch { resolve(failure('native', 'Invalid daemon JSON response')); }
        });
      });
      request.once('timeout', () => { request.destroy(); resolve(failure('unavailable', 'Daemon request timed out; inspect the operation before retrying')); });
      request.once('error', () => resolve(failure('unavailable', 'Cannot connect to the selected fleet daemon')));
      request.end(content);
    });
  }
  return { call };
}
