import { useState } from 'react';
import type { EnrollmentView } from '@crossfire/contracts/schema/response';
import { call, operations, useResource, useAction } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Help, Loaded, Page, Panel, Pagination, PageItems, Status, timestamp } from './ui.js';

function Approval({ item }: { item: EnrollmentView }) {
  const viewer = useSession(), action = useAction(), [code, setCode] = useState('');
  const request = item.enrollment, pending = request.status === 'pending' && request.expiresAt > Date.now();
  const decide = (decision: 'approve' | 'reject') => call(operations.decideEnrollment, { enrollmentId: request.enrollmentId },
    { expectedRevision: request.revision, decision, verificationCode: code }, viewer.csrfSecret);
  return <Panel title={request.fleetKey ? 'Fleet: ' + request.fleetKey : 'Agent enrollment'} description="Check this roster against the request in your terminal before approving.">
    <div className="enrollment-summary"><Status value={request.status}/><span>{request.controllerName ?? 'Project-local listener'}</span><span>Requested {timestamp(request.createdAt)}</span>{pending && <span>Approve by {timestamp(request.expiresAt)}</span>}</div>
    <PageItems items={item.instances} parameter="rosterPage">{instances => <div className="table-wrap"><table aria-label="Enrollment roster"><thead><tr><th>Instance</th><th>Agent name</th><th>Outcome</th><th>Details</th></tr></thead><tbody>{instances.map(instance =>
      <tr key={instance.instanceKey}><td>{instance.instanceKey}</td><td>{instance.requestedName}</td><td><Status value={instance.outcome}/></td><td>{instance.failureCode ?? ''}
        {instance.agentId && <a href={'/manage/agents/' + instance.agentId}>Agent details →</a>}</td></tr>)}</tbody></table></div>}</PageItems>
    {pending && <form onSubmit={event => { event.preventDefault(); void action.run(() => decide('approve')); }}>
      <p>Verify the exact roster and code printed by your project or fleet controller. New agents get a <strong>private owner DM</strong>, with no additional rooms. Fleet approval authorizes its controller to manage this grouping, not shared-room access.</p>
      <label className="bounded-form">Verification code<input value={code} onChange={event => setCode(event.target.value.toUpperCase())} required minLength={12} maxLength={12} autoComplete="off" className="mono"/></label>
      <Alert>{action.error}</Alert><div className="actions"><button disabled={action.pending || request.ownerId !== viewer.member.memberId}>Approve roster</button>
        <button type="button" disabled={action.pending || code.length !== 12} onClick={() => { if (confirm('Reject this exact request?')) void action.run(() => decide('reject')); }}>Reject</button></div>
    </form>}<Help title="Request ownership and identifiers"><dl><dt>Owner</dt><dd>{request.owner.displayName}<span className="subline">{request.owner.matrixUserId}</span></dd><dt>Approval deadline</dt><dd>{timestamp(request.expiresAt)}</dd><dt>Request</dt><dd className="mono">{request.enrollmentId}</dd></dl></Help>
  </Panel>;
}
export function Enrollments({ id }: { id?: string }) { return id ? <EnrollmentDetail id={id}/> : <EnrollmentList/>; }
function EnrollmentDetail({ id }: { id: string }) {
  const resource = useResource(operations.enrollment, { enrollmentId: id });
  return <Page title="Review enrollment" description="Verify the agent names and code before approving."><a className="back" href="/manage/enrollments">← Enrollment requests</a><Loaded {...resource} retry={resource.refresh}>{result => <Approval item={result.data}/>}</Loaded></Page>;
}
function EnrollmentList() {
  const resource = useResource(operations.enrollments, {}, location.search);
  return <Page title="Enrollment requests" description="Only the named owner can approve a roster." action={<button onClick={resource.refresh}>Refresh</button>}><Loaded {...resource} retry={resource.refresh}>{page => <>
    {page.data.length ? <div className="table-wrap"><table aria-label="Enrollment requests"><thead><tr><th>Request</th><th>Controller</th><th>Owner</th><th>Status</th><th>Approval deadline</th></tr></thead><tbody>{page.data.map(item =>
      <tr key={item.enrollmentId}><td><a className="record-link" href={'/manage/enrollments/' + item.enrollmentId}>{item.fleetKey ?? 'Individual agent'} →</a><span className="subline">Requested {timestamp(item.createdAt)}</span></td><td>{item.controllerName ?? 'Project-local'}</td><td>{item.owner.displayName}<span className="subline">{item.owner.matrixUserId}</span></td><td><Status value={item.status}/></td><td>{timestamp(item.expiresAt)}</td></tr>)}</tbody></table></div>
      : <Empty title="No enrollment requests">Use <a href="/manage/connect">Connect an agent</a> or start a fleet with its controller.</Empty>}<Pagination meta={page.meta}/></>}</Loaded></Page>;
}
