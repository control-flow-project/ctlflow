import { useState } from 'react';
import { parseAgent, sameAccess, type AgentView, type Grant } from '../../../packages/contracts/src/management.js';
import { agentRoom, pageOf, type AgentRoomView } from '../../../packages/contracts/src/views.js';
import { ACTIVITY_REFRESH_MS } from '../../../packages/contracts/src/activity.js';
import { request, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Loaded, Page, Panel, Pagination, Status } from './ui.js';

const rooms = pageOf(agentRoom);
const accessLabel = (grant: Grant | undefined) => !grant ? 'No access' : grant.access === 'custom' ? 'Level ' + grant.level : grant.access === 'read' ? 'Read only' : 'Read & reply';

function GrantRow({ agent, room, id, refresh }: { agent: AgentView; room: AgentRoomView | undefined; id: string; refresh: () => void }) {
  const { human, csrf } = useSession();
  const action = useAction();
  const saved = agent.grants.find(grant => grant.room === id);
  const applied = agent.applied.find(grant => grant.room === id);
  const [access, setAccess] = useState(saved?.access ?? '');
  const [level, setLevel] = useState(String(saved?.access === 'custom' ? saved.level : room?.replyLevel ?? 0));
  const [muted, setMuted] = useState(saved?.muted ?? false);
  const owner = agent.owner === human.id;
  const name = room?.name ?? 'Room no longer accessible';
  const pending = saved && (!applied || !sameAccess(saved, applied) || saved.muted !== applied.muted) || !saved && applied;
  async function save() {
    const grant: Grant | undefined = !access ? undefined : access === 'custom' ? { room: id, access: 'custom', level: Number(level), muted }
      : { room: id, access: access as 'read' | 'reply', muted };
    await action.run(() => request('/_coord/agents/' + agent.id + '/grants', 'PUT', {
      revision: agent.revision, grants: [...agent.grants.filter(value => value.room !== id), ...(grant ? [grant] : [])],
    }, csrf), refresh);
  }
  return <tr><td><strong>{room ? <a href={'/manage/agents/' + agent.id + '/rooms/' + encodeURIComponent(id)}>{name}</a> : name}</strong><span className="subline">{room?.alias ?? id}</span>{room?.topic && <span className="subline">{room.topic}</span>}</td>
    <td><fieldset disabled={action.pending || agent.status !== 'active'}><label className="sr-only" htmlFor={'access-' + id}>Access for {name}</label><select id={'access-' + id} value={access} onChange={event => setAccess(event.target.value)}><option value="">No access</option><option value="read" disabled={!room || !owner && !saved}>Read only</option><option value="reply" disabled={!room || room.replyLevel === null || !owner && saved?.access !== 'reply'}>Read & reply</option><option value="custom" disabled={!room || !owner && saved?.access !== 'custom'}>Custom power level</option></select>
      {access === 'custom' && <label className="custom-level">Matrix power level<input type="number" required step="1" value={level} max={room?.ownerCreator ? Number.MAX_SAFE_INTEGER : room?.ownerLevel} min={Number.MIN_SAFE_INTEGER} onChange={event => setLevel(event.target.value)}/></label>}
      <div className="room-actions"><label className="check"><input type="checkbox" disabled={!access} checked={muted} onChange={event => setMuted(event.target.checked)}/>Mute delivery</label>
      <button type="button" className="room-save" disabled={access === 'custom' && (!level || !Number.isSafeInteger(Number(level)))} onClick={() => { void save(); }}>Save access</button></div></fieldset><Alert>{action.error}</Alert></td>
    <td><Status value={accessLabel(applied)}/>{pending && <span className="subline">Change pending</span>}{agent.error && <span className="subline">{agent.error}</span>}</td>
    <td>{room ? <><span>{room.ownerCreator ? 'Room creator' : 'Owner level ' + room.ownerLevel}</span><span className="subline">{room.replyLevel === null ? 'Owner cannot send messages and reactions here.' : 'Reply uses native level ' + room.replyLevel + ', including the room’s permissions at that level.'}</span></> : <span>Remove this grant; the owner no longer has room access.</span>}</td></tr>;
}

function RoomTable({ agent, available, refresh, includeUnavailable = false }: { agent: AgentView; available: AgentRoomView[]; refresh: () => void; includeUnavailable?: boolean }) {
  const candidates = [...available.map(room => room.id), ...(includeUnavailable ? agent.grants.filter(grant => !available.some(room => room.id === grant.room)).map(grant => grant.room) : [])];
  return <div className="table-wrap agent-room-table"><table><thead><tr><th>Room</th><th>Assigned access</th><th>Applied access</th><th>Native permissions</th></tr></thead><tbody>{candidates.map(id => <GrantRow key={id + ':' + agent.revision} id={id} agent={agent} room={available.find(room => room.id === id)} refresh={refresh}/>)}</tbody></table></div>;
}

export function AgentRooms({ agent, refresh }: { agent: AgentView; refresh: () => void }) {
  const after = new URLSearchParams(location.search).get('after');
  const resource = useResource('/_coord/agents/' + agent.id + '/rooms?limit=100' + (after ? '&after=' + encodeURIComponent(after) : ''), rooms);
  return <Panel title="Rooms & access" label="Agent rooms" description="Assign access directly. Select a room to see its details and Matrix permissions." action={<button onClick={resource.refresh}>Refresh rooms</button>}><Loaded {...resource} retry={resource.refresh}>{data => <>{data.items.length || agent.grants.length ? <RoomTable agent={agent} available={data.items} refresh={refresh} includeUnavailable={data.next === null && !after}/> : <Empty title="No rooms yet">Join a room in Element with the owner’s account, then refresh this list.</Empty>}<Pagination next={data.next}/></>}</Loaded></Panel>;
}

export function AgentRoomDetail({ id, room }: { id: string; room: string }) {
  const agent = useResource('/_coord/agents/' + id, parseAgent, ACTIVITY_REFRESH_MS);
  const resource = useResource('/_coord/agents/' + id + '/rooms/' + encodeURIComponent(room), agentRoom);
  return <Loaded {...resource} retry={resource.refresh}>{data => <Page title={data.name} description={data.topic || 'Native Matrix room details and delegated access.'}><a className="back" href={'/manage/agents/' + id}>← Agent rooms & activity</a><Panel title="Room details"><dl><dt>Room ID</dt><dd className="mono">{data.id}</dd><dt>Alias</dt><dd>{data.alias ?? 'None'}</dd><dt>Owner authority</dt><dd>{data.ownerCreator ? 'Native room creator' : 'Power level ' + data.ownerLevel}</dd></dl><a className="button" href={'/#/room/' + encodeURIComponent(data.id)}>Open in Element ↗</a></Panel><Panel title="Assigned access"><Loaded {...agent} retry={agent.refresh}>{identity => <RoomTable agent={identity} available={[data]} refresh={agent.refresh}/>}</Loaded></Panel><Panel title="Matrix permission levels"><p>A native power level grants every action at or below it. Crossfire never changes these room-wide thresholds when assigning an agent.</p><div className="table-wrap"><table><thead><tr><th>Action</th><th>Required power level</th></tr></thead><tbody>{data.permissions.map(permission => <tr key={permission.action}><td>{permission.action}</td><td>{permission.level}</td></tr>)}</tbody></table></div></Panel></Page>}</Loaded>;
}
