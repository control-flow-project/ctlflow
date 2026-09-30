import { useId, useState, type ReactNode } from 'react';
import type { Result } from '@crossfire/kernel/result';

export function Alert({ children }: { children?: ReactNode }) {
  return children ? <div className="alert" role="alert">{children}</div> : null;
}
export function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className="form-field"><label htmlFor={id}>{label}</label>{children(id)}</div>;
}
export function Page({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return <div className="page-frame"><header className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-actions">{action}</div>}</header><div className="page-body">{children}</div></div>;
}
export function AccountPage({ title, children }: { title: string; children: ReactNode }) {
  return <main className="account-page"><a className="brand" href="/manage/">crossfire<span>↗</span></a>
    <Page title={title} description={location.host}>{children}</Page><a className="account-chat" href="/">Open Element →</a></main>;
}
export function Panel({ title, description, action, label, children }: { title: string; description?: string; action?: ReactNode; label?: string; children: ReactNode }) {
  return <section className="panel" aria-label={label ?? title}><header className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>{children}</section>;
}
export function CopyText({ label, value, buttonLabel = 'Copy instructions', copiedMessage = 'Copied. Paste into your coding agent.' }: { label: string; value: string; buttonLabel?: string; copiedMessage?: string }) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  async function copy() {
    setState('copying');
    try { await navigator.clipboard.writeText(value); setState('copied'); }
    catch { setState('failed'); }
  }
  return <div className="copy-text">
    <label htmlFor={id}>{label}</label><textarea id={id} readOnly value={value} rows={7} spellCheck={false}/>
    <div className="actions"><button className="primary" type="button" disabled={state === 'copying'} onClick={() => { void copy(); }}>{buttonLabel}</button><span role="status">{state === 'copied' ? copiedMessage : ''}</span></div>
    <Alert>{state === 'failed' ? 'Clipboard access was blocked. Select the instructions above and copy them manually.' : ''}</Alert>
  </div>;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><h2>{title}</h2><p>{children}</p></div>;
}
export function Status({ value }: { value: string }) {
  return <span className={'status status-' + value.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}>{value}</span>;
}
export function Loaded<T>({ result, children, retry }: { result: Result<T> | undefined; children: (value: T) => ReactNode; retry: () => void }) {
  if (!result) return <p role="status" className="loading">Loading…</p>;
  if (!result.ok) return <><Alert>{result.error.message}</Alert><button onClick={retry}>Retry</button>{result.error.code === 'unauthorized' && <a className="button" href="/manage/">Sign in</a>}</>;
  return <>{children(result.value)}</>;
}
export function Pagination({ meta }: { meta: { page?: number; totalPages?: number } }) {
  const current = meta.page ?? 1, total = meta.totalPages ?? 0;
  function link(page: number) { const query = new URLSearchParams(location.search); query.set('page', String(page)); return location.pathname + '?' + query; }
  return <nav className="pagination" aria-label="Pagination">{current > 1 && <a href={link(current - 1)}>← Previous</a>}<span>Page {current} of {Math.max(1, total)}</span>{current < total && <a href={link(current + 1)}>Next →</a>}</nav>;
}
export function timestamp(value: number | null): string { return value === null ? 'Not yet applied' : new Date(value).toLocaleString(); }
export function applied(record: { revision: number; application: { errorMessage: string | null; appliedRevision: number | null } }): string {
  return record.application.errorMessage ? 'Failed' : record.application.appliedRevision === record.revision ? 'Applied' : 'Pending';
}
