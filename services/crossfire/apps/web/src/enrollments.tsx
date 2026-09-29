import { useState } from 'react';
import { enrollment, pageOf, type EnrollmentView } from '../../../packages/contracts/src/views.js';
import { ARTIFACTS, manifest, type Manifest } from '../../../packages/contracts/src/release.js';
import { onboardingUrl } from '../../../packages/contracts/src/onboarding.js';
import { policy } from '../../../packages/contracts/src/management.js';
import { request, useResource, useAction } from './api.js';
import { useSession } from './session.js';
import { Alert, CopyText, Empty, Loaded, Page, Panel, Pagination, Status, timestamp } from './ui.js';

const enrollments = pageOf(enrollment);
function Approval({ item }: { item: EnrollmentView }) {
  const viewer = useSession();
  const action = useAction();
  const [code, setCode] = useState('');
  const pending = item.status === 'pending' && item.expires > Date.now();
  const decide = (decision: string) => request('/_coord/enrollments/' + item.id + '/decision', 'POST', { decision, code }, viewer.csrf);
  return <Panel title={item.name}><dl><dt>Intended owner</dt><dd className="mono">{item.owner}</dd><dt>Expires</dt><dd>{timestamp(item.expires)}</dd><dt>Status</dt><dd><Status value={item.expires <= Date.now() && item.status === 'pending' ? 'Expired' : item.status}/></dd></dl>
    {pending && <form onSubmit={event => { event.preventDefault(); void action.run(() => decide('approve')); }}><p>Verify this request against the code printed in your project’s terminal. Approval creates an agent with <strong>no joined rooms</strong>.</p><label>Verification code<input value={code} onChange={event => setCode(event.target.value.toUpperCase())} required minLength={12} maxLength={12} autoComplete="off" className="mono" placeholder="12-character code"/></label><Alert>{action.error}</Alert><div className="actions"><button className="primary" disabled={action.pending || item.owner !== viewer.human.id}>Approve agent</button><button type="button" disabled={action.pending || code.length !== 12} onClick={() => { void action.run(() => decide('reject')); }}>Reject</button></div></form>}
    {item.agent && <a className="button primary" href={'/manage/agents/' + item.agent}>Manage room access →</a>}</Panel>;
}

export function Enrollments({ id }: { id?: string }) {
  return id ? <EnrollmentDetail id={id}/> : <EnrollmentList/>;
}
function EnrollmentDetail({ id }: { id: string }) {
  const resource = useResource('/_coord/enrollments/' + encodeURIComponent(id), enrollment);
  return <Page title="Approve an agent" description="A human decision before an agent gets an identity."><Loaded {...resource} retry={resource.refresh}>{item => <Approval item={item}/>}</Loaded></Page>;
}
function EnrollmentList() {
  const resource = useResource('/_coord/enrollments' + location.search, enrollments);
  return <Page title="Enrollment requests" description="Only the named owner can approve an agent." action={<button onClick={resource.refresh}>Refresh</button>}><Loaded {...resource} retry={resource.refresh}>{data => <>{data.items.length ? <div className="panel table-wrap"><table><thead><tr><th>Agent</th><th>Owner</th><th>Status</th><th>Expires</th><th/></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{item.name}</td><td className="mono">{item.owner}</td><td><Status value={item.status}/></td><td>{timestamp(item.expires)}</td><td><a href={'/manage/enrollments/' + item.id}>Review →</a></td></tr>)}</tbody></table></div> : <Empty title="No enrollment requests yet">Start with <a href="/manage/connect">Connect an agent</a>: paste its instructions into your coding agent, then review the request here.</Empty>}<Pagination next={data.next}/></>}</Loaded></Page>;
}

export function Connect() {
  const resource = useResource('/_coord/release', manifest);
  const settings = useResource('/_coord/policy', policy);
  return <Page title="Connect an agent" description="Paste one message. Approve the agent. Choose its rooms."><Loaded {...resource} retry={resource.refresh}>{release => <Loaded {...settings} retry={settings.refresh}>{data => <EnrollmentSetup release={release} agentInstructions={data.agentInstructions}/>}</Loaded>}</Loaded></Page>;
}

function EnrollmentSetup({ release, agentInstructions }: { release: Manifest; agentInstructions: string }) {
  const { human } = useSession();
  const origin = location.origin;
  const artifact = (name: string) => origin + '/onboarding/' + release.release + '/' + name;
  const guide = onboardingUrl(origin, human.id);
  const instructions = [
    'Connect this project to Crossfire for ' + human.id + '.',
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
        {human.role === 'administrator' && <a href="/manage/policy">Configure agent instructions →</a>}
      </Panel>
      <Panel title="2. Approve and choose rooms">
          <p>For a new agent, open the approval link it gives you and enter the matching code.</p>
          <a className="button" href={origin + '/manage/enrollments'}>Review enrollment requests →</a>
          <p className="support">New agents have <strong>no joined rooms</strong>. Choose rooms and permissions in management; existing agents keep their access.</p>
          <div className="actions"><a className="button" href={origin + '/manage/agents'}>Manage agents →</a><a className="button" href={origin + '/'}>Open Element →</a>{human.role === 'administrator' && <a className="button" href={origin + '/manage/rooms'}>Manage rooms →</a>}</div>
          <p className="support">Once approved, the listener connects automatically. Its online status appears on the agent’s page.</p>
      </Panel>
    </div>
    <details className="panel setup-details">
      <summary>Connection details &amp; downloads</summary>
      <dl><dt>Crossfire server</dt><dd className="mono">{origin}</dd><dt>Your owner ID</dt><dd className="mono">{human.id}</dd></dl>
      <p><a href={guide}>Inspect the agent’s setup guide →</a></p>
      <p className="support">The guide verifies the client’s size and checksum. It contains no passwords or access tokens. This server must be reachable from the agent’s machine.</p>
      <ul className="download-links" aria-label="Release downloads">{['manifest.json', ...ARTIFACTS].map(name => <li key={name}><a href={artifact(name)}><strong>{name}</strong><span>{artifact(name)}</span></a></li>)}</ul>
    </details>
  </>;
}
