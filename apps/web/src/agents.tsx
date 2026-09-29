import { useState } from 'react';
import { parseAgent, type AgentView } from '../../../packages/contracts/src/management.js';
import { ACTIVITY_REFRESH_MS, HEARTBEAT_MS } from '../../../packages/contracts/src/activity.js';
import { manifest } from '../../../packages/contracts/src/release.js';
import { pageOf } from '../../../packages/contracts/src/views.js';
import { request, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Loaded, Page, Panel, Pagination, Status, applied, timestamp } from './ui.js';
import { AgentRooms } from './agent-rooms.js';
import { ListenerVersions, ReleaseStatus } from './listener-versions.js';
import { agentFilters } from '../../../packages/contracts/src/agent-filters.js';
import { AgentDirectoryFilters } from './agent-filters.js';
import { AgentWake } from './agent-wake.js';

const agents = pageOf(parseAgent);

function duration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ' + seconds % 60 + 's';
  return Math.floor(minutes / 60) + 'h ' + minutes % 60 + 'm';
}

export function Agents() {
  const { human } = useSession();
  const resource = useResource('/_coord/agents' + location.search, agents, ACTIVITY_REFRESH_MS);
  const current = useResource('/_coord/release', manifest, HEARTBEAT_MS);
  const currentRelease = current.result?.ok ? current.result.value.release : null;
  const filters = agentFilters(new URLSearchParams(location.search));
  return <Page title={human.role === 'administrator' ? 'Agents' : 'My agents'} description="Live listeners, explicit room access, and the people who own them." action={<a className="button primary" href="/manage/connect">Connect an agent <span>↗</span></a>}>
    {filters.ok ? <AgentDirectoryFilters initial={filters.value} administrator={human.role === 'administrator'}/> : <Alert>{filters.error.message} <a href="/manage/agents">Reset filters</a></Alert>}
    <div className="section-heading"><h2>{human.role === 'administrator' ? 'Agents across this instance' : 'Your agents'}</h2><button onClick={resource.refresh}>Refresh</button></div>
    <Loaded {...resource} retry={resource.refresh}>{data => <>{data.items.length ? <div className="agent-grid">{data.items.map(agent => <a className="agent-card" key={agent.id} href={'/manage/agents/' + agent.id}><div className="card-top"><span className="avatar">{agent.name.slice(0, 1).toUpperCase()}</span><Status value={agent.activity.status}/></div><h2>{agent.name}</h2><p className="owner">{agent.owner}</p><div className="card-facts"><span><strong>{agent.grants.length}</strong> rooms granted</span><Status value={agent.status}/></div>{currentRelease && <ReleaseStatus current={currentRelease} installed={agent.activity.runs.length ? (agent.activity.runs.find(run => run.release !== currentRelease) ?? agent.activity.runs[0]!).release : agent.activity.lastRelease}/>}<footer><span>{agent.activity.messages.toLocaleString()} messages delivered</span><span>Rooms & activity →</span></footer></a>)}</div> : <Empty title="No agents match these filters">Adjust the filters to include other account states, or connect an agent from your project.</Empty>}<Pagination next={data.next}/></>}</Loaded>
    <div className="quiet-note"><strong>Online means a listener is reporting.</strong><p>Listeners ping automatically every 30 seconds, without involving the model. After 90 seconds without a ping, they show offline. Account access and listener status are separate.</p></div>
  </Page>;
}

function AgentActivity({ agent, refresh }: { agent: AgentView; refresh: () => void }) {
  const { csrf } = useSession();
  const action = useAction();
  const data = agent.activity;
  return <section className="agent-activity" aria-label="Listener activity"><div className="activity-stats">
    <div><span>Listener status</span><strong><Status value={data.status}/></strong><small>{data.listeners} reporting {data.listeners === 1 ? 'listener' : 'listeners'}</small></div>
    <div><span>Active listener time</span><strong>{duration(data.activeMs)}</strong><small>Observed across listener runs</small></div>
    <div><span>Messages delivered</span><strong>{data.messages.toLocaleString()}</strong><small>Receipt-confirmed chat inputs</small></div>
    <div><span>Last heartbeat</span><strong className="last-seen">{data.lastSeen === null ? 'Never connected' : timestamp(data.lastSeen)}</strong><small>Refreshes automatically</small></div>
  </div><div className="activity-controls"><p>Activity is reported by the listener, not Matrix presence or completed model work. No model calls are made for reporting.</p><button className="danger" disabled={action.pending || data.status !== 'online'} onClick={() => {
    if (confirm('Disconnect all currently reporting listeners for this agent? They stop at their next heartbeat, within 30 seconds when reachable. Codex and room grants are unchanged.')) {
      void action.run(() => request('/_coord/agents/' + agent.id + '/disconnect', 'POST', {}, csrf), refresh);
    }
  }}>{data.status === 'disconnecting' ? 'Disconnect requested' : 'Disconnect listener'}</button></div><Alert>{action.error}</Alert></section>;
}

function AgentSettings({ agent }: { agent: AgentView }) {
  const viewer = useSession();
  const action = useAction();
  const [name, setName] = useState(agent.name);
  const mutate = (data: unknown) => request('/_coord/agents/' + agent.id, 'PATCH', { revision: agent.revision, ...data as Record<string, unknown> }, viewer.csrf);
  return <Panel title="Identity & lifecycle"><dl><dt>Verified owner</dt><dd className="mono">{agent.owner}</dd><dt>Matrix identity</dt><dd className="mono">{agent.userId}</dd><dt>Native display name</dt><dd>{agent.nativeName ?? 'Not available'}</dd><dt>Account</dt><dd><Status value={agent.status}/></dd><dt>Last applied</dt><dd>{timestamp(agent.lastSuccess)}</dd></dl><Alert>{agent.error}</Alert>
    {viewer.human.role === 'administrator' && agent.status !== 'revoked' && <form onSubmit={event => { event.preventDefault(); void action.run(() => mutate({ name })); }}><label>Configured display name<input value={name} maxLength={200} required onChange={event => setName(event.target.value)}/></label><div className="actions"><button disabled={action.pending}>Save name</button><button type="button" disabled={action.pending} onClick={() => { void action.run(() => mutate({ name: null })); }}>Use owner-qualified name</button></div></form>}
    <Alert>{action.error}</Alert>{agent.status !== 'revoked' && <div className="actions"><button disabled={action.pending} onClick={() => { void action.run(() => mutate({ status: agent.status === 'active' ? 'suspended' : 'active' })); }}>{agent.status === 'active' ? 'Suspend agent' : 'Reactivate agent'}</button><button className="danger" disabled={action.pending} onClick={() => { if (confirm('Permanently revoke this agent’s account? This cannot be undone.')) void action.run(() => mutate({ status: 'revoked' })); }}>Revoke account</button></div>}
    <p className="support">Suspension and revocation apply through Matrix. Pending or failed changes are not yet fully enforced.</p></Panel>;
}

export function AgentDetail({ id }: { id: string }) {
  const resource = useResource('/_coord/agents/' + encodeURIComponent(id), parseAgent, ACTIVITY_REFRESH_MS);
  return <Page title="Agent details" description="Live activity and room-by-room access, in one place." action={<button onClick={resource.refresh}>Refresh status</button>}><a className="back" href="/manage/agents">← Agents</a><Loaded {...resource} retry={resource.refresh}>{agent => <><div className="detail-heading"><span className="avatar">{agent.name.slice(0, 1).toUpperCase()}</span><div><h2>{agent.name}</h2><span className="owner">{agent.owner}</span> <Status value={applied(agent)}/></div></div>
    <AgentActivity agent={agent} refresh={resource.refresh}/><AgentWake key={agent.revision} agent={agent} refresh={resource.refresh}/><ListenerVersions activity={agent.activity}/><AgentRooms agent={agent} refresh={resource.refresh}/><AgentSettings key={agent.revision} agent={agent}/>
  </>}</Loaded></Page>;
}
