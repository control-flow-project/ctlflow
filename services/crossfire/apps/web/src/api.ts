import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@ctlflow/crossfire-adapter-crossfire/client';
import type { Operation } from '@ctlflow/crossfire-contracts/rest/operation';
import type { Response } from '@ctlflow/crossfire-contracts/rest/envelope';
import { success, type Result } from '@ctlflow/crossfire-kernel/result';
export { operations } from '@ctlflow/crossfire-contracts/rest/operations';

export async function call<Params extends Record<string, string>, Query, Input, Output>(operation: Operation<Params, Query, Input, Output>,
  params: Params, input: Input, csrf?: string): Promise<Result<Output>> {
  const result = await createClient({ origin: location.origin, ...(csrf ? { csrf } : {}) }).call(operation, params, input);
  return result.ok ? success(result.value.data) : result;
}
export function useResource<Params extends Record<string, string>, Query, Output>(operation: Operation<Params, Query, {}, Output>,
  params: Params, search = '', pollMs?: number) {
  const [result, setResult] = useState<Result<Response<Output>>>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const key = JSON.stringify(params);
  useEffect(() => {
    const stop = new AbortController();
    setResult(undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      const response = await createClient({ origin: location.origin, signal: stop.signal }).call(operation, params, {}, new URLSearchParams(search));
      if (stop.signal.aborted) return;
      setResult(response);
      if (pollMs) timer = setTimeout(() => { void read(); }, pollMs);
    }
    void read();
    return () => { stop.abort(); clearTimeout(timer); };
  }, [operation, key, search, revision, pollMs]);
  return { result, refresh };
}
export function useAction() {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  async function run<Value>(action: () => Promise<Result<Value>>, complete: (value: Value) => void = () => location.reload()) {
    if (locked.current) return;
    locked.current = true; setPending(true); setError('');
    try { const result = await action(); if (result.ok) complete(result.value); else setError(result.error.message); }
    catch { setError('The request failed. Refresh to check its status before trying again.'); }
    finally { locked.current = false; setPending(false); }
  }
  return { error, pending, run };
}
