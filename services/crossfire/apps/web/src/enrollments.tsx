import { useState } from 'react';
import type { EnrollmentView } from '@crossfire/contracts/schema/response';
import { ARTIFACTS, type Manifest } from '@crossfire/contracts/release';
import { onboardingUrl } from '@crossfire/contracts/onboarding';
import { call, operations, useResource, useAction } from './api.js';
import { useSession } from './session.js';
import { Alert, CopyText, Empty, Loaded, Page, Panel, Pagination, Status, timestamp } from './ui.js';

function Approval({ item }: { item: EnrollmentView }) {
  const viewer = useSession(), action = useAction(), [code, setCode] = useState('');
  const request = item.enrollment, pending = request.status === 'pending' && request.expiresAt > Date.now();
  const decide = (decision: 'approve' | 'reject') => call(operations.decideEnrollment, { enrollmentId: request.enrollmentId },
    { expectedRevision: request.revision, decision, verificationCode: code }, viewer.csrfSecret);
  return <Panel title={request.fleetKey ? 'Fleet: ' + request.fleetKey : 'Agent enrollment'}>
    <dl><dt>Owner ID</dt><dd className="mono">{request.ownerId}</dd><dt>Controller</dt><dd>{request.controllerName ?? 'Project-local listener'}</dd>
      <dt>Expires</dt><dd>{timestamp(request.expiresAt)}</dd><dt>Status</dt><dd><Status value={request.status}/></dd></dl>
    <div className="table-wrap"><table><thead><tr><th>Instance</th><th>Agent name</th><th>Outcome</th><th>Details</th></tr></thead><tbody>{item.instances.map(instance =>
      <tr key={instance.instanceKey}><td>{instance.instanceKey}</td><td>{instance.requestedName}</td><td><Status value={instance.outcome}/></td><td>{instance.failureCode ?? ''}
        {instance.agentId && <a href={'/manage/agents/' + instance.agentId}>Agent details →</a>}</td></tr>)}</tbody></table></div>
    {pending && <form onSubmit={event => { event.preventDefault(); void action.run(() => decide('approve')); }}>
      <p>Verify the exact roster and code printed by your project or fleet controller. New agents have <strong>no rooms</strong>. Fleet approval also authorizes its controller to manage this grouping, not room access.</p>
      <label>Verification code<input value={code} onChange={event => setCode(event.target.value.toUpperCase())} required minLength={12} maxLength={12} autoComplete="off" className="mono"/></label>
      <Alert>{action.error}</Alert><div className="actions"><button disabled={action.pending || request.ownerId !== viewer.member.memberId}>Approve roster</button>
        <button type="button" disabled={action.pending || code.length !== 12} onClick={() => { if (confirm('Reject this exact request?')) void action.run(() => decide('reject')); }}>Reject</button></div>
    </form>}
  </Panel>;
}
export function Enrollments({ id }: { id?: string }) { return id ? <EnrollmentDetail id={id}/> : <EnrollmentList/>; }
function EnrollmentDetail({ id }: { id: string }) {
  const resource = useResource(operations.enrollment, { enrollmentId: id });
  return <Page title="Review enrollment" description="Verify the agent names and code before approving."><Loaded {...resource} retry={resource.refresh}>{result => <Approval item={result.data}/>}</Loaded></Page>;
}
function EnrollmentList() {
  const resource = useResource(operations.enrollments, {}, location.search);
  return <Page title="Enrollment requests" description="Only the named owner can approve a roster." action={<button onClick={resource.refresh}>Refresh</button>}><Loaded {...resource} retry={resource.refresh}>{page => <>
    {page.data.length ? <div className="table-wrap"><table><thead><tr><th>Request</th><th>Controller</th><th>Owner ID</th><th>Status</th><th>Expires</th></tr></thead><tbody>{page.data.map(item =>
      <tr key={item.enrollmentId}><td><a href={'/manage/enrollments/' + item.enrollmentId}>{item.fleetKey ?? 'Individual agent'} →</a></td><td>{item.controllerName ?? '—'}</td><td className="mono">{item.ownerId}</td><td><Status value={item.status}/></td><td>{timestamp(item.expiresAt)}</td></tr>)}</tbody></table></div>
      : <Empty title="No enrollment requests">Use <a href="/manage/connect">Connect an agent</a> or start a fleet with its controller.</Empty>}<Pagination meta={page.meta}/></>}</Loaded></Page>;
}

export function Connect() {
  const resource = useResource(operations.release, {});
  const settings = useResource(operations.policy, {});
  return <Page title="Connect an agent" description="Setup instructions for a project or fleet."><Loaded {...resource} retry={resource.refresh}>{release => <Loaded {...settings} retry={settings.refresh}>{data => <EnrollmentSetup release={release.data} agentInstructions={data.data.agentInstructions}/>}</Loaded>}</Loaded></Page>;
}

function EnrollmentSetup({ release, agentInstructions }: { release: Manifest; agentInstructions: string }) {
  const { member } = useSession();
  const origin = location.origin;
  const artifact = (name: string) => origin + '/onboarding/' + release.release + '/' + name;
  const guide = onboardingUrl(origin, member.matrixUserId);
  const instructions = [
    'Connect this project to Crossfire for ' + member.matrixUserId + '.',
    'Follow the setup guide: ' + guide,
    'Reuse the existing project identity; if none exists, ask me for a name. Show me any approval link and code.',
    ...(agentInstructions ? ['', 'Additional instructions from the system administrator:', agentInstructions] : []),
  ].join('\n');
  return <>
    <div className="setup-grid">
      <Panel title="1. Paste into your coding agent">
        <p>Open Codex in your project with <code>runcodex.sh</code>, then paste this message. Your agent asks for a name only on first setup.</p>
        <CopyText label="Instructions for your agent" value={instructions}/>
        <p className="support">The same message handles setup, reconnects and upgrades. Installation and listener connection are automatic.</p>
        {member.roleCode === 'administrator' && <a href="/manage/policy">Configure agent instructions →</a>}
      </Panel>
      <Panel title="2. Approve and choose rooms">
          <p>For a new agent, open the approval link it gives you and enter the matching code.</p>
          <a className="button" href={origin + '/manage/enrollments'}>Review enrollment requests →</a>
          <p className="support">New agents have <strong>no joined rooms</strong>. Choose rooms and permissions in management; existing agents keep their access.</p>
          <p>Create and configure rooms in Element. Assign agent access from the agent's management page.</p>
          <div className="actions"><a className="button" href={origin + '/manage/agents'}>Manage agents →</a><a className="button" href={origin + '/'}>Open Element →</a></div>
          <p className="support">Once approved, the listener connects automatically. Its online status appears on the agent’s page.</p>
      </Panel>
    </div>
    <Panel title="Connect a fleet" description="Configure the fleet once. Its controller enrolls and connects every instance without model calls.">
      <CopyText label="Coordination block for runtime.toml" value={'[coordination]\nadapter = "crossfire"\nserver = ' + JSON.stringify(origin) + '\nowner = ' + JSON.stringify(member.matrixUserId)}
        buttonLabel="Copy fleet configuration" copiedMessage="Copied. Add to the fleet’s runtime.toml."/>
      <p>On the controller’s computer, run <code>fleet add /absolute/path/to/fleet</code> and <code>fleet start FLEET_NAME</code>. The CLI displays one approval link for the complete roster.</p>
      <p className="support">Later, run the same start command. Existing identities, rooms and native sessions resume automatically. Manage execution through fleet; manage access here.</p>
      <a href="/manage/fleets">View fleets →</a>
    </Panel>
    <details className="panel setup-details">
      <summary>Connection details &amp; downloads</summary>
      <dl><dt>Crossfire server</dt><dd className="mono">{origin}</dd><dt>Your owner ID</dt><dd className="mono">{member.matrixUserId}</dd></dl>
      <p><a href={guide}>Inspect the agent’s setup guide →</a></p>
      <p className="support">The guide verifies the client’s size and checksum. It contains no passwords or access tokens. This server must be reachable from the agent’s machine.</p>
      <ul className="download-links" aria-label="Release downloads">{['manifest.json', ...ARTIFACTS].map(name => <li key={name}><a href={artifact(name)}><strong>{name}</strong><span>{artifact(name)}</span></a></li>)}</ul>
    </details>
  </>;
}
