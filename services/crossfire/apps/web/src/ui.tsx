import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChatLink } from './backend.js';
import type { Result } from '@ctlflow/crossfire-kernel/result';

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
    <Page title={title} description={location.host}>{children}</Page><ChatLink className="account-chat"/></main>;
}
export function Panel({ title, description, action, label, children }: { title: string; description?: string; action?: ReactNode; label?: string; children: ReactNode }) {
  return <section className="panel" aria-label={label ?? title}><header className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>{children}</section>;
}
export function ViewNavigation({ label, items }: { label: string; items: readonly { label: string; href: string; current: boolean }[] }) {
  return <nav className="view-navigation" aria-label={label}>{items.map(item => <a key={item.href} href={item.href} aria-current={item.current ? 'page' : undefined}>{item.label}</a>)}</nav>;
}
export function SubjectHeading({ name, description, children }: { name: string; description: ReactNode; children?: ReactNode }) {
  return <div className="subject-heading"><span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span><div className="subject-identity"><h2>{name}</h2><div className="subject-description">{description}</div></div><div className="subject-status">{children}</div></div>;
}
export function Help({ title, children }: { title: string; children: ReactNode }) {
  return <details className="context-help"><summary>{title}</summary><div>{children}</div></details>;
}
export function CopyText({ label, value, rows = 7, buttonLabel = 'Copy instructions', copiedMessage = 'Copied. Paste into your coding agent.', failureMessage = 'Clipboard access was blocked. Select the instructions above and copy them manually.' }: { label: string; value: string; rows?: number; buttonLabel?: string; copiedMessage?: string; failureMessage?: string }) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  async function copy() {
    setState('copying');
    try { await navigator.clipboard.writeText(value); setState('copied'); }
    catch { setState('failed'); }
  }
  return <div className="copy-text">
    <label htmlFor={id}>{label}</label><textarea id={id} readOnly value={value} rows={rows} spellCheck={false}/>
    <div className="actions"><button className="primary" type="button" disabled={state === 'copying'} onClick={() => { void copy(); }}>{buttonLabel}</button><span role="status">{state === 'copied' ? copiedMessage : ''}</span></div>
    <Alert>{state === 'failed' ? failureMessage : ''}</Alert>
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
export function Pagination({ meta, parameter = 'page', onPage }: { meta: { page?: number; totalPages?: number; totalItems?: number; pageSize?: number }; parameter?: string; onPage?: (page: number) => void }) {
  const total = Math.max(1, meta.totalPages ?? 1), current = Math.max(1, Math.min(meta.page ?? 1, total));
  const [requested, setRequested] = useState(String(current));
  useEffect(() => { setRequested(String(current)); }, [current]);
  function link(page: number, size?: number) { const query = new URLSearchParams(location.search); query.set(parameter, String(page)); if (size !== undefined) query.set('pageSize', String(size)); return location.pathname + '?' + query; }
  function go(page: number) { if (Number.isSafeInteger(page) && page >= 1 && page <= total) { if (onPage) onPage(page); else location.assign(link(page)); } }
  function control(label: string, page: number, disabled: boolean) { return onPage ? <button type="button" disabled={disabled} onClick={() => go(page)}>{label}</button> : disabled ? <span className="pagination-disabled" aria-disabled="true">{label}</span> : <a className="pagination-button" href={link(page)}>{label}</a>; }
  return <nav className="pagination" aria-label="Pagination"><div className="pagination-count">{meta.totalItems !== undefined && <span>{meta.totalItems} items</span>}
    {meta.pageSize !== undefined && parameter === 'page' && <label>Rows per page<select aria-label="Rows per page" value={meta.pageSize} onChange={event => location.assign(link(1, Number(event.target.value)))}>{[...new Set([10, 20, 50, 100, meta.pageSize])].sort((left, right) => left - right).map(size => <option key={size} value={size}>{size}</option>)}</select></label>}</div>
    <div className="pagination-controls">{control('First', 1, current === 1)}{control('Previous', current - 1, current === 1)}
      <label>Page<input type="number" aria-label="Page number" min={1} max={total} value={requested} onChange={event => setRequested(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); go(Number(requested)); } }} disabled={total === 1}/><span>of {total}</span></label>
      {control('Next', current + 1, current === total)}{control('Last', total, current === total)}</div></nav>;
}
export function pagingQuery(parameter = 'page'): string {
  const source = new URLSearchParams(location.search), query = new URLSearchParams();
  const page = source.get(parameter), size = source.get('pageSize');
  if (page !== null) query.set('page', page);
  if (size !== null) query.set('pageSize', size);
  return query.toString();
}
export function PageItems<Item>({ items, parameter, children }: { items: readonly Item[]; parameter: string; children: (page: readonly Item[]) => ReactNode }) {
  const total = Math.max(1, Math.ceil(items.length / 20)), requested = Number(new URLSearchParams(location.search).get(parameter) ?? 1);
  const [selected, setSelected] = useState(Number.isSafeInteger(requested) ? Math.max(1, requested) : 1);
  const page = Math.min(selected, total);
  function go(next: number) {
    const query = new URLSearchParams(location.search); query.set(parameter, String(next));
    history.replaceState(null, '', location.pathname + '?' + query);
    setSelected(next);
  }
  return <>{children(items.slice((page - 1) * 20, page * 20))}<Pagination parameter={parameter} meta={{ page, totalPages: total, totalItems: items.length }} onPage={go}/></>;
}
export function timestamp(value: number | null): string { return value === null ? 'Not yet applied' : new Date(value).toLocaleString(); }
export function applied(record: { revision: number; application: { errorMessage: string | null; appliedRevision: number | null } }): string {
  return record.application.errorMessage ? 'Failed' : record.application.appliedRevision === record.revision ? 'Applied' : 'Pending';
}
