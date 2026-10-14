import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@ctlflow/crossfire-client/client';
import type { FleetView } from '@ctlflow/crossfire-contracts/schema/response';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import { readFleetDirectory } from './fleet-directory/read.js';
export function useFleetDirectory(search: string) {
  const [result, setResult] = useState<Result<FleetView[]>>(), [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setResult(undefined);
    async function read() {
      const response = await readFleetDirectory(createClient({ origin: location.origin, signal: stop.signal }), search);
      if (stop.signal.aborted) return;
      setResult(response);
      timer = setTimeout(() => { void read(); }, 5000);
    }
    void read();
    return () => { stop.abort(); clearTimeout(timer); };
  }, [search, revision]);
  return { result, refresh };
}
