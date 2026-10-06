import { useState, type Dispatch, type Ref, type SetStateAction } from 'react';
import type { OutputOf } from '@ctlflow/crossfire-contracts/rest/operation';
import { operations, useResource } from './api.js';
import { Empty, Field, Loaded, Pagination } from './ui.js';

export type WakeSenders = OutputOf<typeof operations.wakePolicy>['senders'];

export function WakeSenderTable({ senders, onChange }: { senders: WakeSenders; onChange?: Dispatch<SetStateAction<WakeSenders>> }) {
  const [requested, setPage] = useState(1), totalPages = Math.max(1, Math.ceil(senders.length / 20)), page = Math.min(requested, totalPages);
  return senders.length ? <><div className="table-wrap"><table aria-label="Selected wake-up people and agents"><thead><tr><th>Person / agent</th><th>Who can wake</th>{onChange && <th>Action</th>}</tr></thead><tbody>
    {senders.slice((page - 1) * 20, page * 20).map(({ identity, includeAgents }) => <tr key={identity.principalId}>
      <td><strong>{identity.displayName}</strong><span className="subline mono">{identity.matrixUserId}</span>{identity.kind === 'agent' && <span className="subline">Agent of {identity.ownerMatrixId}</span>}</td>
      <td>{onChange && identity.kind === 'human' ? <select aria-label={'Wake scope for ' + identity.matrixUserId} value={includeAgents ? 'group' : 'person'}
        onChange={event => { const group = event.target.value === 'group'; onChange(previous => previous.map(sender => sender.identity.principalId === identity.principalId ? { ...sender, includeAgents: group } : sender)); }}>
        <option value="person">This person only</option><option value="group">This person + their agents</option></select> : includeAgents ? 'This person + their agents' : identity.kind === 'human' ? 'This person only' : 'This agent only'}</td>
      {onChange && <td><button type="button" aria-label={'Remove ' + identity.matrixUserId} onClick={() => onChange(previous => previous.filter(sender => sender.identity.principalId !== identity.principalId))}>Remove</button></td>}
    </tr>)}</tbody></table></div>{totalPages > 1 && <Pagination meta={{ page, totalPages, totalItems: senders.length }} onPage={setPage}/>}</>
    : <Empty title="No selected entries">No individual people or agents are selected.</Empty>;
}

export function WakePicker({ agentId, senders, setSenders, searchRef }: { agentId: string; senders: WakeSenders; setSenders: Dispatch<SetStateAction<WakeSenders>>; searchRef?: Ref<HTMLInputElement> }) {
  const [search, setSearch] = useState(''), [kind, setKind] = useState('human'), [page, setPage] = useState(1);
  const query = new URLSearchParams({ search, kind, excludeId: agentId, page: String(page), pageSize: '20' });
  const directory = useResource(operations.principals, {}, query.toString()), selectedIds = new Set(senders.map(sender => sender.identity.principalId));
  return <div className="wake-picker"><section aria-label="Selected wake-up entries"><header className="picker-heading"><h3>Selected <span className="picker-count">{senders.length}</span></h3>
    <button type="button" disabled={!senders.length} onClick={() => setSenders([])}>Clear selection</button></header>
    <WakeSenderTable senders={senders} onChange={setSenders}/></section>
    <section aria-label="Find wake-up people"><h3>Add people</h3><p className="support">Select a person, then choose whether to include their agents. With agents included, new agents they own are allowed automatically.</p>
      <div className="filter-bar"><label>Search people or Matrix IDs<input ref={searchRef} type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}/></label>
        <Field label="Show">{id => <select id={id} value={kind} onChange={event => { setKind(event.target.value); setPage(1); }}><option value="human">People</option><option value="agent">Individual agents</option></select>}</Field></div>
      <Loaded {...directory} retry={directory.refresh}>{result => <>{result.data.length ? <div className="table-wrap"><table aria-label="Available wake-up identities"><thead><tr><th>Select</th><th>Identity</th><th>Scope</th></tr></thead><tbody>
        {result.data.map(identity => <tr key={identity.principalId}><td><input type="checkbox" aria-label={'Allow ' + identity.matrixUserId} checked={selectedIds.has(identity.principalId)} disabled={!selectedIds.has(identity.principalId) && senders.length >= 2000}
          onChange={event => { const checked = event.target.checked; setSenders(previous => checked ? previous.some(sender => sender.identity.principalId === identity.principalId) ? previous : [...previous, { identity, includeAgents: false }] : previous.filter(sender => sender.identity.principalId !== identity.principalId)); }}/></td>
          <td><strong>{identity.displayName}</strong><span className="subline mono">{identity.matrixUserId}</span>{identity.kind === 'agent' && <span className="subline">Agent of {identity.ownerMatrixId}</span>}</td>
          <td>{identity.kind === 'human' ? 'Person; agents optional' : 'This agent only'}</td></tr>)}</tbody></table></div>
        : <Empty title="No matches">Try a name or a Matrix ID. Your selection is retained.</Empty>}
        <Pagination meta={{ ...result.meta, page }} onPage={setPage}/></>}</Loaded>
    </section><p role="status" className="support">{senders.length} selected. All entries combine; room access is still required.</p></div>;
}
