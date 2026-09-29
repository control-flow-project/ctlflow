import { useId, useState, type ReactNode } from 'react';
import type { Result } from '../../../packages/contracts/src/result.js';

export function Alert({ children }: { children?: ReactNode }) {
  return children ? <div className="alert" role="alert">{children}</div> : null;
}
export function Page({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return <div className="page-frame"><header className="page-heading"><div><p className="eyebrow">YOUR COORDINATION SPACE</p><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-actions">{action}</div>}</header><div className="page-body">{children}</div></div>;
}
export function Panel({ title, description, action, label, children }: { title: string; description?: string; action?: ReactNode; label?: string; children: ReactNode }) {
  return <section className="panel" aria-label={label ?? title}><header className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>{children}</section>;
}
export function CopyText({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  async function copy() {
    setState('copying');
    try { await navigator.clipboard.writeText(value); setState('copied'); }
    catch { setState('failed'); }
  }
  return <div className="copy-text">
    <label htmlFor={id}>{label}</label><textarea id={id} readOnly value={value} rows={7} spellCheck={false}/>
    <div className="actions"><button className="primary" type="button" disabled={state === 'copying'} onClick={() => { void copy(); }}>Copy instructions</button><span role="status">{state === 'copied' ? 'Copied. Paste into your coding agent.' : ''}</span></div>
    <Alert>{state === 'failed' ? 'Clipboard access was blocked. Select the instructions above and copy them manually.' : ''}</Alert>
  </div>;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><span className="empty-mark" aria-hidden="true">↗</span><h2>{title}</h2><p>{children}</p></div>;
}
export function Status({ value }: { value: string }) {
  return <span className={'status status-' + value.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}>{value}</span>;
}
export function Loaded<T>({ result, children, retry }: { result: Result<T> | undefined; children: (value: T) => ReactNode; retry: () => void }) {
  if (!result) return <p role="status" className="loading">Loading…</p>;
  if (!result.ok) return <><Alert>{result.error.message}</Alert><button onClick={retry}>Retry</button>{result.error.code === 'unauthorized' && <a className="button" href="/manage/">Sign in</a>}</>;
  return <>{children(result.value)}</>;
}
export function Pagination({ next, parameter = 'after' }: { next: string | number | null; parameter?: string }) {
  const query = new URLSearchParams(location.search);
  const previous = query.has(parameter);
  query.delete(parameter);
  const first = location.pathname + (query.size ? '?' + query : '');
  if (next !== null) query.set(parameter, String(next));
  return <div className="pagination">{previous && <a href={first}>First page</a>}{next !== null && <a href={location.pathname + '?' + query}>Next page →</a>}</div>;
}
export function timestamp(value: number | null): string { return value === null ? 'Not yet applied' : new Date(value).toLocaleString(); }
export function applied(record: { error: string | null; appliedRevision: number | null; revision: number }): string {
  return record.error ? 'Failed' : record.appliedRevision === record.revision ? 'Applied' : 'Pending';
}
