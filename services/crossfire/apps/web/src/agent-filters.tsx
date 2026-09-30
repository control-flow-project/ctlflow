import { useState } from 'react';
import { useSession } from './session.js';
import { operations, useResource } from './api.js';
import { Field, Loaded, Pagination } from './ui.js';
import { filterQuery } from './form.js';
export function OwnerFilter() {
  const [number, setNumber] = useState(1), [selected, setSelected] = useState(new URLSearchParams(location.search).get('ownerId') ?? '');
  const [label, setLabel] = useState(selected), resource = useResource(operations.members, {}, 'pageSize=50&page=' + number);
  return <div className="owner-filter"><Loaded {...resource} retry={resource.refresh}>{page => <><Field label="Owner">{id => <select id={id} name="ownerId" value={selected} onChange={event => {
    setSelected(event.target.value); setLabel(event.target.selectedOptions[0]?.textContent ?? '');
  }}><option value="">All owners</option>{selected && !page.data.some(member => member.memberId === selected) && <option value={selected}>{label}</option>}
    {page.data.map(member => <option value={member.memberId} key={member.memberId}>{member.displayName} · {member.matrixUserId}</option>)}</select>}</Field>
    {(page.meta.totalPages ?? 0) > 1 && <Pagination key={number} meta={{ page: number, totalPages: page.meta.totalPages ?? 1 }} onPage={setNumber}/>}</>}</Loaded></div>;
}
export function AgentFilters() {
  const viewer = useSession(), query = new URLSearchParams(location.search);
  const [statuses, setStatuses] = useState((query.get('status') ?? 'active,suspended').split(',').filter(Boolean));
  return <form className="filter-bar" onSubmit={event => {
    event.preventDefault(); const next = filterQuery(event.currentTarget);
    next.set('status', ['active', 'suspended', 'revoked'].filter(status => statuses.includes(status)).join(',')); location.assign('/manage/agents?' + next);
  }}><label>Search agents<input name="search" type="search" defaultValue={query.get('search') ?? ''}/></label>
    <Field label="Listener status">{id => <select id={id} name="listener" defaultValue={query.get('listener') ?? 'all'}><option value="all">All listeners</option><option value="online">Online</option><option value="offline">Offline</option><option value="disconnecting">Disconnecting</option></select>}</Field>
    {viewer.permissions.includes('agent.read.any') && <OwnerFilter/>}
    <fieldset className="filter-accounts"><legend>Account status</legend><div>{['active', 'suspended', 'revoked'].map(status => <label key={status} className="check"><input type="checkbox" checked={statuses.includes(status)} onChange={event => setStatuses(previous => event.target.checked ? [...previous, status] : previous.filter(value => value !== status))}/>Show {status}</label>)}</div></fieldset>
    <div className="filter-actions"><button>Apply filters</button><a href="/manage/agents">Reset</a></div>
  </form>;
}
