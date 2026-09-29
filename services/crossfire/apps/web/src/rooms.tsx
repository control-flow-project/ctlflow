import { useState } from 'react';
import { call, operations, useResource, useAction } from './api.js';
import { useSession } from './session.js';
import { Alert, Field, Loaded, Page, Panel, Pagination, Status } from './ui.js';
export function Rooms() {
  const viewer = useSession(), action = useAction(), resource = useResource(operations.rooms, {}, location.search), [name, setName] = useState('');
  return <Page title="Rooms" description="Conversations with native Matrix authority and explicit agent grants.">
    <Panel title="Create a room"><form onSubmit={event => { event.preventDefault(); void action.run(() => call(operations.createRoom, {}, { name }, viewer.csrfSecret)); }}>
      <div className="form-row"><label>Room name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label><button disabled={action.pending}>Create room</button></div><Alert>{action.error}</Alert>
      <p className="support">Accept your invitation in Element, then assign agent access.</p></form></Panel>
    <Loaded {...resource} retry={resource.refresh}>{page => <><div className="agent-grid">{page.data.map(room => <a className="agent-card" href={'/manage/rooms/' + encodeURIComponent(room.roomId)} key={room.roomId}><h2>{room.name}</h2><p>{room.alias ?? room.roomId}</p><span>Manage membership →</span></a>)}</div><Pagination meta={page.meta}/></>}</Loaded>
  </Page>;
}
function MembershipEditor({ roomId }: { roomId: string }) {
  const viewer = useSession(), action = useAction();
  const [search, setSearch] = useState(''), [targetId, setTarget] = useState(''), [operation, setOperation] = useState<'invite' | 'kick'>('invite'), [number, setNumber] = useState(1);
  const principals = useResource(operations.principals, {}, new URLSearchParams({ search, pageSize: '50', page: String(number) }).toString());
  async function change() {
    const target = principals.result?.ok ? principals.result.value.data.find(identity => identity.principalId === targetId) : undefined;
    if (target?.kind === 'agent') {
      const grant = await call(operations.grant, { agentId: targetId, roomId }, {});
      if (!grant.ok) return grant;
      return call(operations.changeMembership, { roomId }, { targetId, action: operation, expectedRevision: grant.value.revision, expectedGeneration: grant.value.grant?.generation ?? null }, viewer.csrfSecret);
    }
    return call(operations.changeMembership, { roomId }, { targetId, action: operation }, viewer.csrfSecret);
  }
  return <form onSubmit={event => { event.preventDefault(); if (confirm(operation === 'invite' ? 'Invite the selected identity?' : 'Remove the selected identity from this room?')) void action.run(() =>
    change()); }}>
    <label>Find people or agents<input type="search" value={search} onChange={event => { setSearch(event.target.value); setTarget(''); setNumber(1); }}/></label>
    <Loaded {...principals} retry={principals.refresh}>{page => <><Field label="Identity">{id => <select id={id} required value={targetId} onChange={event => setTarget(event.target.value)}><option value="">Select an identity</option>
      {page.data.map(identity => <option key={identity.principalId} value={identity.principalId}>{identity.displayName} · {identity.matrixUserId}</option>)}</select>}</Field>
      <div className="pagination"><button type="button" disabled={number <= 1} onClick={() => { setNumber(number - 1); setTarget(''); }}>Previous identities</button><span>Page {number}</span>
        <button type="button" disabled={number >= (page.meta.totalPages ?? 0)} onClick={() => { setNumber(number + 1); setTarget(''); }}>Next identities</button></div></>}</Loaded>
    <Field label="Action">{id => <select id={id} value={operation} onChange={event => setOperation(event.target.value === 'kick' ? 'kick' : 'invite')}><option value="invite">Invite</option><option value="kick">Remove</option></select>}</Field>
    <button disabled={!targetId || action.pending}>Apply membership</button><Alert>{action.error}</Alert><p className="support">Agent targets use the same durable grant authorization as their management page. This cannot bypass ownership or native room authority.</p></form>;
}
export function RoomMembers({ id }: { id: string }) {
  const room = useResource(operations.room, { roomId: id }), members = useResource(operations.roomMembers, { roomId: id }, location.search);
  return <Page title="Room details" description="Room membership and native permissions."><a href="/manage/rooms" className="back">← Rooms</a>
    <Loaded {...room} retry={room.refresh}>{result => <Panel title={result.data.name}><p>{result.data.topic}</p><p className="mono">{result.data.roomId}</p><MembershipEditor roomId={id}/></Panel>}</Loaded>
    <Panel title="Members"><Loaded {...members} retry={members.refresh}>{page => <><div className="table-wrap"><table><thead><tr><th>Identity</th><th>Membership</th><th>Power level</th></tr></thead>
      <tbody>{page.data.map(member => <tr key={member.matrixUserId}><td>{member.displayName}<span className="subline">{member.matrixUserId}</span></td><td><Status value={member.membership}/></td><td>{member.powerLevel}</td></tr>)}</tbody></table></div><Pagination meta={page.meta}/></>}</Loaded></Panel></Page>;
}
