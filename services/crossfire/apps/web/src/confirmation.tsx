import { useRef, useState } from 'react';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import { Dialog } from './dialog.js';
import { Alert } from './ui.js';

type Confirmation = { title: string; description: string; label: string; danger?: boolean; execute(): Promise<Result<unknown>> };

export function useConfirmation() {
  const [request, setRequest] = useState<Confirmation>(), [pending, setPending] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), cancelFocus = useRef<HTMLButtonElement>(null);
  function cancel() { if (!locked.current) { setRequest(undefined); setError(''); } }
  async function execute() {
    if (!request || locked.current) return;
    locked.current = true; setPending(true); setError('');
    try {
      const result = await request.execute();
      if (result.ok) setRequest(undefined); else setError(result.error.message);
    } catch { setError('The request failed. Refresh to check its status before trying again.'); }
    finally { locked.current = false; setPending(false); }
  }
  return {
    request(value: Confirmation) { if (!locked.current) { setError(''); setRequest(value); } },
    dialog: request && <Dialog title={request.title} description={request.description} busy={pending} initialFocus={cancelFocus} onCancel={cancel}
      footer={<div className="actions"><button ref={cancelFocus} type="button" disabled={pending} onClick={cancel}>Cancel</button>
        <button type="button" className={request.danger ? 'danger' : 'primary'} disabled={pending} onClick={() => { void execute(); }}>{pending ? 'Applying…' : request.label}</button></div>}>
      <Alert>{error}</Alert>
    </Dialog>,
  };
}
