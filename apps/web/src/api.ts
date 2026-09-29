import { useCallback, useEffect, useState } from 'react';
import { failure, success, type Result, type Failure } from '../../../packages/kernel/src/result.js';

export async function request(path: string, method = 'GET', input?: unknown, csrf?: string, signal?: AbortSignal): Promise<Result<unknown>> {
  try {
    const response = await fetch(path, { method, credentials: 'same-origin', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      headers: { ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...(csrf ? { 'X-Crossfire-CSRF': csrf } : {}) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    const data: unknown = await response.json();
    if (response.ok) return success(data);
    const code: Failure['code'] = ({ 401: 'unauthorized', 403: 'forbidden', 404: 'missing', 409: 'conflict', 429: 'limit' } as Record<number, Failure['code']>)[response.status] ?? 'native';
    const message = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
    return failure(code, typeof message === 'string' ? message : message && typeof message === 'object' && 'message' in message && typeof message.message === 'string'
      ? message.message : 'The request could not be completed. Please try again.');
  } catch { return failure('native', 'Cannot reach the service. Check your connection and retry.'); }
}

export function useResource<T>(path: string, parse: (value: unknown) => Result<T>, pollMs?: number) {
  const [result, setResult] = useState<Result<T>>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const stop = new AbortController();
    setResult(undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      const response = await request(path, 'GET', undefined, undefined, stop.signal);
      if (stop.signal.aborted) return;
      setResult(response.ok ? parse(response.value) : response);
      if (pollMs) timer = setTimeout(() => { void read(); }, pollMs);
    }
    void read();
    return () => { stop.abort(); clearTimeout(timer); };
  }, [path, parse, revision, pollMs]);
  return { result, refresh };
}

export function useAction() {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function run(action: () => Promise<Result<unknown>>, complete: (value: unknown) => void = () => location.reload()) {
    if (pending) return;
    setPending(true); setError('');
    try { const result = await action(); if (result.ok) complete(result.value); else setError(result.error.message); }
    catch { setError('The request failed. Refresh to check its status before trying again.'); }
    finally { setPending(false); }
  }
  return { error, pending, run };
}
