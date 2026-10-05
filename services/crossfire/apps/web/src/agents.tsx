import { useState } from 'react';
import type { AgentView } from '@ctlflow/crossfire-contracts/schema/response';
import { HEARTBEAT_MS } from '@ctlflow/crossfire-contracts/activity';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Help, Loaded, Page, Panel, Pagination, Status, SubjectHeading, applied, timestamp } from './ui.js';
import { AgentFilters } from './agent-filters.js';
import { AgentRooms } from './agent-rooms.js';
import { AgentWake } from './agent-wake.js';
import { ListenerVersions } from './listener-versions.js';
import { AgentNavigation, type AgentSection } from './agent-navigation.js';
import { AgentSessions } from './fleet-sessions.js';
import { NativeRuntimeStatus } from './runtime-status.js';
import { Runtime } from './runtime.js';
import { Decisions } from './decisions.js';
import { AgentRetirement } from './retirement.js';

export function Agents() {
  const resource = useResource(operations.agents, {}, location.search, HEARTBEAT_MS);
  return <Page title="Agents" description="Agents across your fleets, with listener readiness and native session status."
    action={<><button onClick={resource.refresh}>Refresh</button><a className="button primary" href="/manage/connect">Set up an agent ↗</a></>}>
      <AgentFilters/><Loaded {...resource} retry={resource.refresh}>{page => <>{page.data.length ? <div className="table-wrap"><table aria-label="Agents"><thead><tr><th scope="col">Agent</th><th scope="col">Owner</th><th scope="col">Fleet / controller</th><th scope="col">Listener</th><th scope="col">Native session</th><th scope="col">Account</th><th scope="col">Last heartbeat</th></tr></thead><tbody>{page.data.map(agent =>
        <tr key={agent.agentId}><td><a className="record-link" href={'/manage/agents/' + agent.agentId}>{agent.displayName}</a></td><td>{agent.owner.displayName}<span className="subline">{agent.owner.matrixUserId}</span></td><td><a href={'/manage/fleets/' + agent.deployment.fleetId}>{agent.deployment.label}</a><span className="subline">{agent.deployment.controllerName}</span></td><td><Status value={agent.activity.status}/></td><td><NativeRuntimeStatus agent={agent}/></td><td><Status value={agent.status}/></td><td>{agent.activity.lastSeenAt === null ? <span className="muted">Not reported</span> : timestamp(agent.activity.lastSeenAt)}</td></tr>)}</tbody></table></div>
        : <Empty title="No matching agents">Set up an agent or adjust the filters.</Empty>}<Pagination meta={page.meta}/></>}</Loaded>
    <Help title="What does listener status mean?"><p>Listeners ping every 30 seconds without model calls. They show offline after 90 seconds without a ping. Account access and native activity are separate.</p>
      <p>Every agent’s controller hosts its listener. An agent can sleep while that listener remains ready. Eligible messages resume its saved history; a manually stopped session requires an explicit resume.</p></Help>
  </Page>;
}
function Activity({ agent }: { agent: AgentView }) {
  const activity = agent.activity;
  return <><Panel title="Listener activity"><div className="activity-stats">
    <div><span>Listener status</span><strong><Status value={activity.status}/></strong><small>{activity.activeRuns.length} reporting listeners</small></div>
    <div><span>Active listener time</span><strong>{Math.floor(activity.activeMs / 60000)}m {Math.floor(activity.activeMs / 1000) % 60}s</strong><small>Observed across listener runs</small></div>
    <div><span>Messages delivered</span><strong>{activity.messagesDelivered}</strong><small>Receipt-confirmed chat inputs</small></div>
    <div><span>Last heartbeat</span><strong className="last-seen">{activity.lastSeenAt === null ? 'Not reported' : timestamp(activity.lastSeenAt)}</strong><small>Refreshes automatically</small></div></div>
    <p className="support">Reporting is separate from Matrix presence and completed model work. No model calls are made for reporting.</p>
    <div className="actions"><a className="button" href={'/manage/agents/' + agent.agentId + '/session'}>Manage session →</a><a href={'/manage/fleets/' + agent.deployment.fleetId + '/activity'}>Fleet delivery and traffic →</a></div></Panel></>;
}
function Lifecycle({ agent }: { agent: AgentView }) {
  const viewer = useSession(), action = useAction();
  const [name, setName] = useState(agent.displayName), [revision] = useState(agent.revision);
  const change = (input: { displayName?: string | null; status?: 'active' | 'suspended' | 'revoked' }) =>
    call(operations.changeAgent, { agentId: agent.agentId }, { expectedRevision: revision, ...input }, viewer.csrfSecret);
  const mutable = agent.allowedActions.includes('configure') && agent.status !== 'revoked';
  return <><Panel title="Display name" description="The name shown in management and Matrix."><form className="bounded-form" onSubmit={event => { event.preventDefault(); void action.run(() => change({ displayName: name })); }}>
      <fieldset disabled={!mutable || action.pending}><label>Configured display name<input maxLength={200} required value={name} onChange={event => setName(event.target.value)}/></label>
        <div className="actions"><button>Save name</button><button type="button" onClick={() => { void action.run(() => change({ displayName: null })); }}>Use owner-qualified name</button></div></fieldset></form>
    <Alert>{action.error}</Alert></Panel><Panel title="Account access" description="Suspension is reversible. Revocation permanently disables this identity."><dl><dt>Account</dt><dd><Status value={agent.status}/></dd><dt>Native application</dt><dd><Status value={applied(agent)}/></dd><dt>Last applied</dt><dd>{timestamp(agent.application.lastSuccessAt)}</dd></dl><Alert>{agent.application.errorMessage}</Alert>
    <div className="actions">{mutable && <><button disabled={action.pending} onClick={() => {
      if (confirm(agent.status === 'active' ? 'Suspend this agent’s account access?' : 'Reactivate this agent?')) void action.run(() => change({ status: agent.status === 'active' ? 'suspended' : 'active' }));
    }}>{agent.status === 'active' ? 'Suspend agent' : 'Activate agent'}</button><button className="danger" disabled={action.pending} onClick={() => {
      if (confirm('Permanently revoke this agent? This cannot be undone.')) void action.run(() => change({ status: 'revoked' }));
    }}>Revoke account</button></>}</div><Alert>{action.error}</Alert><p className="support">Pending or failed changes are not yet fully enforced by Matrix.</p>
  </Panel><Panel title="Identity"><dl><dt>Verified owner</dt><dd>{agent.owner.displayName}<span className="subline">{agent.owner.matrixUserId}</span></dd><dt>Matrix identity</dt><dd className="mono">{agent.matrixUserId}</dd></dl>
    <Help title="Fleet deployment details"><dl><dt>Fleet</dt><dd><a href={'/manage/fleets/' + agent.deployment.fleetId}>{agent.deployment.label}</a></dd><dt>Instance</dt><dd>{agent.deployment.instanceKey}</dd><dt>Controller</dt><dd>{agent.deployment.controllerName}</dd><dt>Last reported</dt><dd>{timestamp(agent.deployment.reportedAt)}</dd></dl><p>Controller details identify the deployment. Listener heartbeats determine whether this agent is online.</p></Help></Panel><AgentRetirement agent={agent}/></>;
}
export function AgentDetail({ id, section }: { id: string; section: AgentSection }) {
  const resource = useResource(operations.agent, { agentId: id }, '', 5000);
  return <Page title="Agent details" description="Listener activity, room access and account settings." action={<button onClick={resource.refresh}>Refresh status</button>}>
    <a className="back" href="/manage/agents">← Agents</a><Loaded {...resource} retry={resource.refresh}>{({ data: agent }) => <>
      <SubjectHeading name={agent.displayName} description={<>{agent.owner.displayName} · {agent.owner.matrixUserId}<span className="subline">Fleet <a href={'/manage/fleets/' + agent.deployment.fleetId}>{agent.deployment.label}</a> · {agent.deployment.controllerName}</span></>}><Status value={agent.activity.status}/><NativeRuntimeStatus agent={agent} compact/><Status value={agent.status}/></SubjectHeading>
      <AgentNavigation id={id} section={section}/>{section === 'rooms' && <><AgentRooms agent={agent}/><AgentWake agent={agent}/></>}
      {section === 'session' && <><Decisions id={id}/><AgentSessions agent={agent}/><Runtime agent={agent}/></>}
      {section === 'activity' && <Activity agent={agent}/>} {section === 'settings' && <><ListenerVersions agent={agent}/><Lifecycle agent={agent}/></>}
    </>}</Loaded>
  </Page>;
}
