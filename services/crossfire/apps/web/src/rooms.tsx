import { useState } from 'react';
import { pageOf, managedRoom, roomMember } from '../../../packages/contracts/src/views.js';
import { request, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Loaded, Page, Panel, Pagination, Status } from './ui.js';

const rooms = pageOf(managedRoom);
const members = pageOf(roomMember);
export function Rooms() {
  const { csrf } = useSession();
  const resource = useResource('/_coord/managed-rooms' + location.search, rooms);
  const [name, setName] = useState('');
  const action = useAction();
  return <Page title="Rooms" description="Private conversations with explicit membership. Agents enter only through grants."><Panel title="Create a room"><form onSubmit={event => { event.preventDefault(); void action.run(() => request('/_coord/managed-rooms', 'POST', { name }, csrf), () => { setName(''); resource.refresh(); }); }}><div className="form-row"><label>Room name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label><button className="primary" disabled={action.pending}>Create room</button></div><Alert>{action.error}</Alert><p className="support">Accept your invitation in Element, then invite teammates and grant your agents access.</p></form></Panel><Loaded {...resource} retry={resource.refresh}>{data => <>{data.items.length ? <div className="agent-grid">{data.items.map(room => <a className="panel" href={'/manage/rooms/' + encodeURIComponent(room.id)} key={room.id}><h2>{room.name}</h2><p className="mono">{room.id}</p><span>Manage membership →</span></a>)}</div> : <Empty title="Room to collaborate">Create a private room for your team’s conversation.</Empty>}<Pagination next={data.next}/></>}</Loaded></Page>;
}
export function RoomMembers({ id }: { id: string }) {
  const { csrf } = useSession();
  const route = '/_coord/managed-rooms/' + encodeURIComponent(id) + '/members';
  const resource = useResource(route + location.search, members);
  const [user, setUser] = useState('');
  const action = useAction();
  return <Page title="Room membership" description={id}><a className="back" href="/manage/rooms">← Rooms</a><Panel title="Invite a person"><form onSubmit={event => { event.preventDefault(); void action.run(() => request(route, 'POST', { user, action: 'invite' }, csrf), () => { setUser(''); resource.refresh(); }); }}><div className="form-row"><label>Member Matrix ID<input required value={user} onChange={event => setUser(event.target.value)} placeholder="@person:server"/></label><button className="primary" disabled={action.pending}>Invite member</button></div><p className="support">Use agent details to grant rooms to an agent.</p></form></Panel><Alert>{action.error}</Alert><Loaded {...resource} retry={resource.refresh}>{data => <><div className="panel table-wrap"><table><thead><tr><th>Member</th><th>Matrix ID</th><th>Membership</th><th/></tr></thead><tbody>{data.items.map(member => <tr key={member.id}><td>{member.name}</td><td className="mono">{member.id}</td><td><Status value={member.membership}/></td><td><button className="danger" disabled={action.pending || !member.removable} onClick={() => { if (confirm('Remove this member from the room? Agent grant removal may be pending until reconciliation.')) void action.run(() => request(route, 'POST', { user: member.id, action: 'kick' }, csrf), resource.refresh); }}>Remove</button></td></tr>)}</tbody></table></div><Pagination next={data.next}/></>}</Loaded></Page>;
}
