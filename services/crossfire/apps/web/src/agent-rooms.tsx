import { useState } from 'react';
import type { AgentView, RoomView, RoomGrantView } from '@ctlflow/crossfire-contracts/schema/response';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { useConfirmation } from './confirmation.js';
import { useEditable, EditConflict } from './use-editable.js';
import { Alert, Help, Loaded, Page, Panel, Pagination, PageItems, Status, SubjectHeading, timestamp } from './ui.js';

const labels = { none: 'No access', read: 'Read only', reply: 'Read & reply', custom: 'Custom power level' } as const;
function GrantEditor({ agent, room, view }: { agent: AgentView; room: RoomView; view?: RoomGrantView }) {
  const viewer = useSession(), action = useAction(), confirmation = useConfirmation();
  const edit = useEditable(agent.agentId + '/' + room.roomId, { revision: view?.revision ?? agent.revision, generation: view?.grant?.generation ?? null },
    { mode: view?.grant?.accessMode ?? 'none', muted: view?.grant?.muted ?? false, level: view?.grant?.powerLevel ?? 0 });
  const { mode, muted, level } = edit.value;
  const editable = agent.allowedActions.includes('room-grant.manage') && agent.status !== 'revoked';
  const canReply = room.authority && (room.authority.creator || room.authority.powerLevel !== null && room.authority.replyLevel <= room.authority.powerLevel);
  const nativeCreator = room.authority?.creatorIds.includes(agent.matrixUserId) ?? false;
  if (view?.ownerConversation) return <div><Status value="Read & reply"/><span className="subline">Owner DM · always available</span><span className="support">Private messages and native approvals. Access cannot be disabled.</span></div>;
  return <form onSubmit={event => { event.preventDefault();
    if (edit.conflict) return;
    const params = { agentId: agent.agentId, roomId: room.roomId }, base = { expectedRevision: edit.version.revision, expectedGeneration: edit.version.generation };
    const execute = () => action.run(() => mode === 'none' ? call(operations.removeGrant, params, base, viewer.csrfSecret)
      : call(operations.setGrant, params, { ...base, accessMode: mode, powerLevel: mode === 'custom' ? level : null, muted }, viewer.csrfSecret));
    if (mode === 'none' && edit.version.generation) confirmation.request({ title: 'Remove room access?', description: 'Remove ' + agent.displayName + '’s access to ' + room.name + '.', label: 'Remove access', danger: true, execute });
    else void execute();
  }}><fieldset disabled={!editable || action.pending}><label className="sr-only" htmlFor={'access-' + room.roomId}>Access for {room.name}</label>
    <select id={'access-' + room.roomId} value={mode} onChange={event => { const value = event.target.value; if (value === 'none' || value === 'read' || value === 'reply' || value === 'custom') edit.setValue(previous => ({ ...previous, mode: value })); }}>
      <option value="none">No access</option><option value="read" disabled={!room.authority || nativeCreator}>Read only</option>
      <option value="reply" disabled={!canReply}>Read &amp; reply</option><option value="custom" disabled={!room.authority || nativeCreator}>Custom power level</option></select>
    {mode === 'custom' && <label>Power level<input type="number" required value={level} max={room.authority?.creator ? undefined : room.authority?.powerLevel ?? undefined} onChange={event => edit.setValue(previous => ({ ...previous, level: Number(event.target.value) }))}/></label>}
    <div className="room-actions"><label className="check"><input type="checkbox" disabled={mode === 'none'} checked={muted} onChange={event => edit.setValue(previous => ({ ...previous, muted: event.target.checked }))}/>Mute delivery</label><button className="room-save" disabled={edit.conflict}>Save access</button></div>
    <EditConflict {...edit}/></fieldset>{nativeCreator && <p className="support">Matrix made this agent a room creator. Its native authority cannot be reduced; you can mute delivery or remove its membership.</p>}<Alert>{action.error}</Alert>{confirmation.dialog}</form>;
}
function AppliedGrant({ view }: { view?: RoomGrantView }) {
  const grant = view?.grant, application = view?.application;
  const status = application?.errorMessage ? 'Failed' : !grant ? 'No access'
    : application?.observedGeneration === grant.generation && application.appliedRevision === grant.revision ? labels[grant.accessMode] : 'Pending';
  return <><Status value={status}/>{application?.creator && application.membership === 'join' && <span className="subline">Native room creator</span>}{application?.errorMessage && <span className="subline">{application.errorMessage}</span>}</>;
}
function Authority({ room }: { room: RoomView }) {
  return room.authority ? <><span>{room.authority.creator ? 'Room creator' : 'Your power level ' + room.authority.powerLevel}</span>
    <span className="subline">Reply requires native level {room.authority.replyLevel}.</span></> : <span>No current native authority for this room</span>;
}
export function AgentRooms({ agent }: { agent: AgentView }) {
  const [page, setPage] = useState(1), [search, setSearch] = useState('');
  const rooms = useResource(operations.rooms, {}, new URLSearchParams({ agentId: agent.agentId, search, page: String(page), pageSize: '20' }).toString());
  return <Panel title="Rooms & access" description="Assign access directly. Select a room for native permissions and delegation." action={<button onClick={rooms.refresh}>Refresh rooms</button>}>
    <label>Search rooms<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}/></label>
    <Loaded {...rooms} retry={rooms.refresh}>{found => <>
      <RoomAssignments agent={agent} rooms={found.data}/>
      {!found.data.length && <p>No matching rooms. Join or create a room in Element, then refresh.</p>}
      <Pagination meta={{ page, totalPages: found.meta.totalPages ?? 1, totalItems: found.meta.totalItems ?? 0 }} onPage={setPage}/>
    </>}</Loaded></Panel>;
}
function RoomAssignments({ agent, rooms }: { agent: AgentView; rooms: RoomView[] }) {
  const query = new URLSearchParams({ roomIds: JSON.stringify(rooms.map(room => room.roomId)), pageSize: String(Math.max(1, rooms.length)) });
  const grants = useResource(operations.grants, { agentId: agent.agentId }, query.toString(), 5000);
  return <Loaded {...grants} retry={grants.refresh}>{assigned => <>
      <div className="table-wrap agent-room-table"><table><thead><tr><th>Room</th><th>Assigned access</th><th>Applied access</th><th>Native permissions</th></tr></thead>
        <tbody>{rooms.map(room => { const grant = assigned.data.find(view => view.grant?.roomId === room.roomId); return <tr key={room.roomId}>
          <td><strong><a href={'/manage/agents/' + agent.agentId + '/rooms/' + encodeURIComponent(room.roomId)}>{room.name}</a></strong><span className="subline">{room.alias ?? room.roomId}</span></td>
          <td><GrantEditor agent={agent} room={room} {...(grant ? { view: grant } : {})}/></td><td><AppliedGrant {...(grant ? { view: grant } : {})}/></td><td><Authority room={room}/></td></tr>; })}</tbody></table></div>
    </>}</Loaded>;
}
function Delegation({ view, roomId }: { view: RoomGrantView; roomId: string }) {
  const viewer = useSession(), action = useAction();
  const edit = useEditable(view.agentId + '/' + roomId + '/permissions', { revision: view.revision, generation: view.grant?.generation ?? null }, view.permissions.includes('room.agent.invite'));
  const grant = view.grant;
  if (view.ownerConversation) return <p>Owner DMs stay private between this agent and its owner. Invitation delegation is not available.</p>;
  if (!grant || grant.accessMode === 'none') return <p>Grant room access before delegating invitations.</p>;
  return <form onSubmit={event => { event.preventDefault(); if (edit.conflict || !edit.version.generation) return; void action.run(() => call(operations.setGrantPermissions, { agentId: view.agentId, roomId },
    { expectedRevision: edit.version.revision, expectedGeneration: edit.version.generation, permissions: edit.value ? ['room.agent.invite'] : [] }, viewer.csrfSecret)); }}>
    <fieldset disabled={!view.allowedActions.includes('permissions.set') || action.pending}><label className="check"><input type="checkbox" checked={edit.value} onChange={event => edit.setValue(event.target.checked)}/>Allow this agent to invite other registered agents</label>
      <p className="support">May cross owners, within the inviter’s native Matrix authority. The agent may remove only additions it made. It cannot pass this permission onward.</p><button disabled={edit.conflict}>Save invitation permission</button><EditConflict {...edit}/></fieldset><Alert>{action.error}</Alert>
    <Help title="Grant provenance"><dl><dt>Added by principal</dt><dd className="mono">{grant.addedById}</dd><dt>Authorizing principal</dt><dd className="mono">{grant.authorizerId}</dd><dt>Membership generation</dt><dd className="mono">{grant.generation}</dd></dl></Help></form>;
}
export function AgentRoomDetail({ id, room }: { id: string; room: string }) {
  const agent = useResource(operations.agent, { agentId: id }), resource = useResource(operations.room, { roomId: room }, new URLSearchParams({ agentId: id }).toString());
  const grant = useResource(operations.grant, { agentId: id, roomId: room }, '', 5000);
  return <Page title="Room access" description="Room access, Matrix permissions and agent invitations."><a className="back" href={'/manage/agents/' + id}>← Agent details</a>
    <Loaded {...agent} retry={agent.refresh}>{identity => <Loaded {...resource} retry={resource.refresh}>{native => <Loaded {...grant} retry={grant.refresh}>{access => <>
      <SubjectHeading name={native.data.name} description={<>Access for {identity.data.displayName}{native.data.alias && <span className="subline">{native.data.alias}</span>}</>}><AppliedGrant view={access.data}/></SubjectHeading>
      <Panel title="Room access" description="Set the permissions this agent needs in this room."><div className="bounded-form"><GrantEditor agent={identity.data} room={native.data} view={access.data}/></div><p className="support">Last applied: {timestamp(access.data.application?.lastSuccessAt ?? null)}</p>{native.data.topic && <Help title="Room topic"><p>{native.data.topic}</p></Help>}<Help title="Immutable room ID"><code>{room}</code></Help></Panel>
      <Panel title="Agent invitations"><Delegation view={access.data} roomId={room}/></Panel>
      <Panel title="Native Matrix permissions"><Authority room={native.data}/><Help title="View native permission thresholds"><PageItems items={native.data.authority?.nativePermissions ?? []} parameter="permissionsPage">{permissions => <div className="table-wrap"><table aria-label="Native permission thresholds"><thead><tr><th>Action</th><th>Required power</th></tr></thead><tbody>
        {permissions.map(permission => <tr key={permission.action}><td>{permission.action}</td><td>{permission.level}</td></tr>)}</tbody></table></div>}</PageItems></Help></Panel>
    </>}</Loaded>}</Loaded>}</Loaded></Page>;
}
