import { useState } from 'react';
import type { AgentView } from '@crossfire/contracts/schema/response';
import { HEARTBEAT_MS } from '@crossfire/contracts/activity';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Loaded, Page, Panel, Pagination, Status, applied, timestamp } from './ui.js';
import { AgentFilters } from './agent-filters.js';
import { AgentRooms } from './agent-rooms.js';
import { AgentWake } from './agent-wake.js';
import { ListenerVersions } from './listener-versions.js';

export function AgentCard({ agent }: { agent: AgentView }) {
  return <a className="agent-card" href={'/manage/agents/' + agent.agentId}><div className="card-top"><span className="avatar">{agent.displayName.slice(0, 1).toUpperCase()}</span><Status value={agent.activity.status}/></div>
    <h2>{agent.displayName}</h2><p className="owner">{agent.owner.displayName} · {agent.owner.matrixUserId}</p>
    <div className="card-facts"><span>{agent.activity.activeRuns.length} reporting listeners</span><Status value={agent.status}/></div>
    {agent.deployment && <p className="support">{agent.deployment.label} · {agent.deployment.controllerName}</p>}
    <footer><span>{agent.activity.messagesDelivered} messages delivered</span><span>Rooms &amp; activity →</span></footer></a>;
}
export function Agents() {
  const resource = useResource(operations.agents, {}, location.search, HEARTBEAT_MS);
  return <Page title="Agents" description="Live listeners, explicit room access, and the people who own them."
    action={<a className="button primary" href="/manage/connect">Connect an agent ↗</a>}>
    <Panel title="Your team, under your control" action={<button onClick={resource.refresh}>Refresh</button>}>
      <AgentFilters/><Loaded {...resource} retry={resource.refresh}>{page => <>{page.data.length ? <div className="agent-grid">{page.data.map(agent => <AgentCard key={agent.agentId} agent={agent}/>)}</div>
        : <Empty title="No matching agents">Connect an agent or adjust the filters.</Empty>}<Pagination meta={page.meta}/></>}</Loaded></Panel>
    <div className="quiet-note"><strong>Online means a listener is reporting.</strong><p>Listeners ping every 30 seconds without model calls. After 90 seconds without a ping they show offline. Account access is separate.</p></div>
  </Page>;
}
function Activity({ agent }: { agent: AgentView }) {
  const viewer = useSession(), action = useAction();
  const activity = agent.activity;
  return <Panel title="Listener activity"><div className="activity-stats">
    <div><span>Listener status</span><strong><Status value={activity.status}/></strong><small>{activity.activeRuns.length} reporting listeners</small></div>
    <div><span>Active listener time</span><strong>{Math.floor(activity.activeMs / 60000)}m {Math.floor(activity.activeMs / 1000) % 60}s</strong><small>Observed across listener runs</small></div>
    <div><span>Messages delivered</span><strong>{activity.messagesDelivered}</strong><small>Receipt-confirmed chat inputs</small></div>
    <div><span>Last heartbeat</span><strong className="last-seen">{timestamp(activity.lastSeenAt)}</strong><small>Refreshes automatically</small></div></div>
    <div className="activity-controls"><p>Listener reporting, not Matrix presence or completed model work. No model calls are made for reporting.</p>
      {agent.allowedActions.includes('listener.disconnect') && <button className="danger" disabled={!activity.activeRuns.length || action.pending} onClick={() => {
        if (confirm('Disconnect these reporting listeners? Agent identity, rooms and saved sessions remain.')) void action.run(() => call(operations.disconnectListeners,
          { agentId: agent.agentId }, { expectedRevision: agent.revision, runIds: activity.activeRuns.map(run => run.runId) }, viewer.csrfSecret));
      }}>Disconnect listener</button>}</div><Alert>{action.error}</Alert></Panel>;
}
function Lifecycle({ agent }: { agent: AgentView }) {
  const viewer = useSession(), action = useAction();
  const [name, setName] = useState(agent.displayName), [revision] = useState(agent.revision);
  const change = (input: { displayName?: string | null; status?: 'active' | 'suspended' | 'revoked' }) =>
    call(operations.changeAgent, { agentId: agent.agentId }, { expectedRevision: revision, ...input }, viewer.csrfSecret);
  const mutable = agent.allowedActions.includes('configure') && agent.status !== 'revoked';
  return <Panel title="Identity & lifecycle"><dl><dt>Verified owner</dt><dd>{agent.owner.displayName} <span className="mono">{agent.owner.matrixUserId}</span></dd>
    <dt>Matrix identity</dt><dd className="mono">{agent.matrixUserId}</dd><dt>Account</dt><dd><Status value={agent.status}/></dd>
    <dt>Native application</dt><dd><Status value={applied(agent)}/></dd><dt>Last applied</dt><dd>{timestamp(agent.application.lastSuccessAt)}</dd></dl>
    <Alert>{agent.application.errorMessage}</Alert><form onSubmit={event => { event.preventDefault(); void action.run(() => change({ displayName: name })); }}>
      <fieldset disabled={!mutable || action.pending}><label>Configured display name<input maxLength={200} required value={name} onChange={event => setName(event.target.value)}/></label>
        <div className="actions"><button>Save name</button><button type="button" onClick={() => { void action.run(() => change({ displayName: null })); }}>Use owner-qualified name</button></div></fieldset></form>
    <div className="actions">{mutable && <><button disabled={action.pending} onClick={() => {
      if (confirm(agent.status === 'active' ? 'Suspend this agent’s account access?' : 'Reactivate this agent?')) void action.run(() => change({ status: agent.status === 'active' ? 'suspended' : 'active' }));
    }}>{agent.status === 'active' ? 'Suspend agent' : 'Activate agent'}</button><button className="danger" disabled={action.pending} onClick={() => {
      if (confirm('Permanently revoke this agent? This cannot be undone.')) void action.run(() => change({ status: 'revoked' }));
    }}>Revoke account</button></>}</div><Alert>{action.error}</Alert><p className="support">Pending or failed changes are not yet fully enforced by Matrix.</p>
  </Panel>;
}
export function AgentDetail({ id }: { id: string }) {
  const resource = useResource(operations.agent, { agentId: id }, '', 5000);
  return <Page title="Agent details" description="Live activity and room-by-room access, in one place." action={<button onClick={resource.refresh}>Refresh status</button>}>
    <a className="back" href="/manage/agents">← Agents</a><Loaded {...resource} retry={resource.refresh}>{({ data: agent }) => <>
      <div className="detail-heading"><span className="avatar">{agent.displayName.slice(0, 1).toUpperCase()}</span><div><h2>{agent.displayName}</h2><span className="owner">{agent.owner.matrixUserId}</span> <Status value={applied(agent)}/></div></div>
      {agent.deployment && <Panel title="Fleet deployment"><dl><dt>Fleet</dt><dd><a href={'/manage/fleets/' + agent.deployment.fleetId}>{agent.deployment.label}</a></dd>
        <dt>Instance</dt><dd>{agent.deployment.instanceKey}</dd><dt>Controller</dt><dd>{agent.deployment.controllerName}</dd><dt>Last reported</dt><dd>{timestamp(agent.deployment.reportedAt)}</dd></dl>
        <p className="support">Controller details identify the deployment. Listener heartbeats determine whether this agent is online.</p></Panel>}
      <Activity agent={agent}/><ListenerVersions agentId={id}/><AgentWake agent={agent}/><AgentRooms agent={agent}/><Lifecycle agent={agent}/>
    </>}</Loaded>
  </Page>;
}
