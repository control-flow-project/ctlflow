import type { Operation } from '@crossfire/contracts/rest/operation';
import { operationPath } from '@crossfire/contracts/rest/operation';
import { decodeFailure, decodeResponse, type Response } from '@crossfire/contracts/rest/envelope';
import { HTTP_LIMITS } from '@crossfire/contracts/rest/limits';
import { failure, type Result } from '@crossfire/kernel/result';

export type ClientOptions = { origin: string; token?: string; csrf?: string; signal?: AbortSignal; timeoutMs?: number; fetch?: typeof fetch };
export function createClient(options: ClientOptions) {
  const origin = new URL(options.origin);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Expected a server origin');
  if (origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Nonlocal servers require HTTPS');
  if (options.token && options.csrf) throw new Error('Choose bearer or browser session authentication');
  return {
    async call<Params extends Record<string, string>, Query, Input, Output>(operation: Operation<Params, Query, Input, Output>,
      params: Params, input: Input, query = new URLSearchParams(), signal?: AbortSignal): Promise<Result<Response<Output>>> {
      const checkedParams = operation.params(params), checkedInput = operation.input(input), checkedQuery = operation.query(query);
      if (!checkedParams.ok) return checkedParams; if (!checkedInput.ok) return checkedInput; if (!checkedQuery.ok) return checkedQuery;
      const serialized = JSON.stringify(checkedInput.value);
      if (new TextEncoder().encode(serialized).byteLength > HTTP_LIMITS.requestBytes) return failure('body_too_large', 'Request exceeds the API input bound');
      const signals = [AbortSignal.timeout(options.timeoutMs ?? HTTP_LIMITS.requestMilliseconds)];
      if (options.signal) signals.push(options.signal); if (signal) signals.push(signal);
      try {
        const url = new URL(operationPath(operation.path, params), origin);
        url.search = query.toString();
        const response = await (options.fetch ?? fetch)(url, { method: operation.method, redirect: 'error', credentials: options.token ? 'omit' : 'same-origin',
          signal: AbortSignal.any(signals), headers: { Accept: 'application/json', ...(operation.method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
            ...(options.token && operation.auth !== 'public' ? { Authorization: 'Bearer ' + options.token } : {}), ...(options.csrf ? { 'X-Crossfire-CSRF': options.csrf } : {}) },
          ...(operation.method === 'GET' ? {} : { body: serialized }) });
        if (!response.body) return failure('native', 'Missing API response');
        const parts: Uint8Array[] = []; let length = 0;
        const reader = response.body.getReader();
        try {
          for (;;) {
            const next = await reader.read(); if (next.done) break;
            length += next.value.byteLength;
            if (length > HTTP_LIMITS.responseBytes) { await reader.cancel(); return failure('limit', 'API response exceeds the output bound'); }
            parts.push(next.value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.length; }
        const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!response.ok) return decodeFailure(data);
        if (response.status !== operation.status) return failure('native', 'Unexpected API success status');
        return decodeResponse(data, operation.output, operation.collection);
      } catch (error) {
        return failure('unavailable', error instanceof Error && error.name === 'AbortError' ? 'API request cancelled' : 'API request failed');
      }
    },
  };
}
export type Client = ReturnType<typeof createClient>;
