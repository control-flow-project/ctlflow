import { useState } from 'react';
import type { MemberView, PolicyView } from '@ctlflow/crossfire-contracts/schema/response';
import { POLICY_LIMITS, DEFAULT_AGENT_INSTRUCTIONS, AGENT_INSTRUCTIONS_MAX_BYTES } from '@ctlflow/crossfire-contracts/policy';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Field, Help, Loaded, Page, Panel, Pagination, Status, applied, timestamp } from './ui.js';
import { auditActionLabel } from './audit-labels.js';
import { sleepDurationSeconds } from './sleep-duration.js';

function MemberRow({ item }: { item: MemberView }) {
  const viewer = useSession(), action = useAction(), params = { memberId: item.memberId };
  return <tr><td><strong>{item.displayName}</strong><span className="subline mono">{item.matrixUserId}</span></td><td>
    <select aria-label={'Role for ' + item.matrixUserId} value={item.roleCode} disabled={action.pending || item.status === 'revoked'} onChange={event => {
      const roleCode = event.target.value === 'administrator' ? 'administrator' : 'member';
      if (confirm('Change this member’s role to ' + roleCode + '?')) void action.run(() => call(operations.memberRole, params, { expectedRevision: item.revision, roleCode }, viewer.csrfSecret));
    }}><option value="member">Member</option><option value="administrator">Administrator</option></select></td>
    <td><Status value={item.status}/></td><td><Status value={applied(item)}/><Alert>{item.application.errorMessage}</Alert></td><td>
      {item.status !== 'revoked' && <div className="actions"><button disabled={action.pending} onClick={() => {
        if (confirm('Change access for this member and their agents?')) void action.run(() => call(operations.changeMember, params, { expectedRevision: item.revision, status: item.status === 'active' ? 'suspended' : 'active' }, viewer.csrfSecret));
      }}>{item.status === 'active' ? 'Suspend' : 'Reactivate'}</button><button className="danger" disabled={action.pending} onClick={() => {
        if (confirm('Permanently revoke this member and their agents?')) void action.run(() => call(operations.changeMember, params, { expectedRevision: item.revision, status: 'revoked' }, viewer.csrfSecret));
      }}>Revoke</button></div>}<Alert>{action.error}</Alert></td></tr>;
}
export function Members() {
  const resource = useResource(operations.members, {}, location.search);
  return <Page title="Members" description="People, roles and account access across this instance." action={<a className="button" href="/manage/invitations">Invite a member ↗</a>}>
    <Loaded {...resource} retry={resource.refresh}>{page => <><div className="table-wrap"><table aria-label="Members"><thead><tr><th>Member</th><th>Role</th><th>Account</th><th>Enforcement</th><th>Actions</th></tr></thead>
      <tbody>{page.data.map(item => <MemberRow key={item.memberId} item={item}/>)}</tbody></table></div><Pagination meta={page.meta}/></>}</Loaded></Page>;
}
export function Invitations() {
  const viewer = useSession(), resource = useResource(operations.invitations, {}, location.search), action = useAction();
  const [roleCode, setRole] = useState<'member' | 'administrator'>('member'), [lifetime, setLifetime] = useState(86400), [link, setLink] = useState('');
  return <Page title="Invitations" description="Give someone a private, one-use link to join this server."><Panel title="Create an invitation" description="The invitee chooses their username and password in Element."><form onSubmit={event => {
    event.preventDefault(); void action.run(() => call(operations.createInvitation, {}, { roleCode, expiresSeconds: lifetime }, viewer.csrfSecret), value => { setLink(value.signupUrl); resource.refresh(); });
  }}><div className="form-row"><Field label="Role">{id => <select id={id} value={roleCode} onChange={event => setRole(event.target.value === 'administrator' ? 'administrator' : 'member')}><option value="member">Member</option>{viewer.member.roleCode === 'administrator' && <option value="administrator">Administrator</option>}</select>}</Field>
    <label>Link lifetime (seconds)<input type="number" min={60} max={604800} required value={lifetime} onChange={event => setLifetime(Number(event.target.value))}/></label><button disabled={action.pending}>Create invitation</button></div><p className="support">The default is one day. Share the link privately with the intended person.</p><Alert>{action.error}</Alert></form>
    {link && <label className="secret-link">Share this private link once<input readOnly value={link} onFocus={event => event.target.select()}/><span className="support">Send it privately to the intended person.</span></label>}</Panel>
    <Panel title="Issued invitations" description="Used, expired and revoked links cannot register another account."><Loaded {...resource} retry={resource.refresh}>{page => <>{page.data.length ? <div className="table-wrap"><table aria-label="Invitations"><thead><tr><th>Created</th><th>Role</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead><tbody>{page.data.map(item => {
      const state = item.revokedAt !== null ? 'Revoked' : item.consumedByMemberId ? 'Used' : item.expiresAt <= Date.now() ? 'Expired' : 'Active';
      return <tr key={item.invitationId}><td>{timestamp(item.createdAt)}<span className="subline mono" title={item.invitationId}>{item.invitationId.slice(0, 8)}</span></td><td>{item.roleCode === 'administrator' ? 'Administrator' : 'Member'}</td><td>{timestamp(item.expiresAt)}</td><td><Status value={state}/></td><td>{state === 'Active' && <button disabled={action.pending} onClick={() => {
        if (confirm('Revoke this signup invitation?')) void action.run(() => call(operations.revokeInvitation, { invitationId: item.invitationId }, {}, viewer.csrfSecret));
      }}>Revoke</button>}</td></tr>;
    })}</tbody></table></div> : <Empty title="No invitations">Create an invitation to let someone register on this server.</Empty>}<Pagination meta={page.meta}/></>}</Loaded></Panel></Page>;
}
function PolicyForm({ initial }: { initial: PolicyView }) {
  const viewer = useSession(), [value, setValue] = useState(initial), action = useAction();
  const [sleepMinutes, setSleepMinutes] = useState(String(initial.fleetIdleTimeoutSeconds / 60));
  const sleepDuration = sleepDurationSeconds(sleepMinutes, POLICY_LIMITS.fleetIdleTimeoutSeconds.max);
  const fields: { key: keyof typeof POLICY_LIMITS; label: string }[] = [
    { key: 'maxOwnerAgents', label: 'Agents per member owner' }, { key: 'maxAgents', label: 'Agents across this instance' },
    { key: 'maxPending', label: 'Pending enrollment requests' }, { key: 'enrollmentSeconds', label: 'Enrollment lifetime (seconds)' },
    { key: 'reconcileSeconds', label: 'Permission reconciliation (seconds)' },
  ];
  const instructionBytes = new TextEncoder().encode(value.agentInstructions).length;
  return <form onSubmit={event => { event.preventDefault(); if (!sleepDuration.ok) return; const { revision, ...settings } = value;
    void action.run(() => call(operations.changePolicy, {}, { ...settings, fleetIdleTimeoutSeconds: sleepDuration.value, expectedRevision: revision }, viewer.csrfSecret)); }}>
    <Panel title="Signup & invitations" description="Choose how people join, and who may invite them."><div className="bounded-form"><Field label="Who can sign up?">{id => <select id={id} value={value.signupMode} onChange={event => setValue({ ...value, signupMode: event.target.value === 'open' ? 'open' : 'invitation' })}><option value="invitation">Invitation links only</option><option value="open">Anyone · open Element signup</option></select>}</Field>
      <Field label="Who can invite members?">{id => <select id={id} value={value.invitationIssuers} onChange={event => setValue({ ...value, invitationIssuers: event.target.value === 'members' ? 'members' : 'administrators' })}><option value="administrators">Administrators only</option><option value="members">Administrators and members</option></select>}</Field>
      <p className="support">Invited people complete normal signup in Element. Members can invite members, never administrators. Signup policy is enforced by the server, not just this page.</p></div></Panel>
    <Panel title="Agent capacity" description="Limit registered agents and pending enrollment requests."><div className="bounded-form">{fields.filter(field => field.key === 'maxOwnerAgents' || field.key === 'maxAgents' || field.key === 'maxPending').map(field => <label key={field.key}>{field.label}<input type="number" min={POLICY_LIMITS[field.key].min} max={POLICY_LIMITS[field.key].max} required disabled={action.pending} value={value[field.key]} onChange={event => setValue({ ...value, [field.key]: Number(event.target.value) })}/></label>)}</div>
      <Help title="How capacity is counted"><p>Members use the per-owner limit. Administrators have no separate owner limit and use the instance capacity, which defaults to 100 agents. Active agents and pending identity reservations count toward capacity.</p></Help></Panel>
    <Panel title="Enrollment & reconciliation" description="Set how long approval links last and how often native permissions are checked."><div className="bounded-form">{fields.filter(field => field.key === 'enrollmentSeconds' || field.key === 'reconcileSeconds').map(field => <label key={field.key}>{field.label}<input type="number" min={POLICY_LIMITS[field.key].min} max={POLICY_LIMITS[field.key].max} required disabled={action.pending} value={value[field.key]} onChange={event => setValue({ ...value, [field.key]: Number(event.target.value) })}/></label>)}</div></Panel>
    <Panel title="Message delivery" description="Large incoming messages and batches are delivered as private files, not expanded into model context."><div className="bounded-form"><label>Inline message limit (UTF-8 bytes)<input type="number" min={4096} max={4194304} required disabled={action.pending} value={value.maxMessageBytes} onChange={event => setValue({ ...value, maxMessageBytes: Number(event.target.value) })}/></label><p className="support">Default: 65,536 bytes (64 KiB). Applies to every agent. Full message content remains available through a private file manifest.</p></div></Panel>
    <Panel title="Fleet idle sleep" description="Stop idle native engines while the controller’s shared listener stays ready."><div className="bounded-form">
      <Field label="Sleep after idle minutes">{id => <><input id={id} type="number" min={0} max={POLICY_LIMITS.fleetIdleTimeoutSeconds.max / 60} step="any" required disabled={action.pending}
        aria-describedby={id + '-help'} aria-invalid={!sleepDuration.ok} value={sleepMinutes} onChange={event => setSleepMinutes(event.target.value)}/>
        <p id={id + '-help'} className="support">Default: 30 minutes. Enter 0 to disable automatic sleep. Eligible messages resume the same saved history; busy agents and agents awaiting a decision do not sleep.</p></>}</Field>
      <p className="support">This instance-wide setting applies to every agent. The fleet controller owns sleep and resume; a manually stopped session stays stopped.</p>
      {!sleepDuration.ok && <Alert>{sleepDuration.error.message}</Alert>}</div></Panel>
    <Panel title="Agent onboarding instructions" description="Additional guidance in every personalized setup guide. Only administrators can edit it."><div className="bounded-form">
      <Field label="Additional agent instructions">{id => <textarea id={id} rows={8} disabled={action.pending} value={value.agentInstructions} onChange={event => setValue({ ...value, agentInstructions: event.target.value })}/>}</Field>
      <p className="support">{instructionBytes} / {AGENT_INSTRUCTIONS_MAX_BYTES} UTF-8 bytes. Plain text only; no secrets. Included in the personalized agent setup guide.</p>
      <button type="button" disabled={action.pending || value.agentInstructions === DEFAULT_AGENT_INSTRUCTIONS} onClick={() => setValue({ ...value, agentInstructions: DEFAULT_AGENT_INSTRUCTIONS })}>Reset to default</button>
      <p className="support">Save settings to apply your edits or reset for everyone.</p></div></Panel><Alert>{action.error}</Alert><div className="actions"><button className="primary" disabled={action.pending || !sleepDuration.ok || instructionBytes > AGENT_INSTRUCTIONS_MAX_BYTES}>Save settings</button><p>Saves all sections together.</p></div></form>;
}
export function Settings() {
  const resource = useResource(operations.policy, {});
  return <Page title="Instance settings" description="Signup, agent limits, delivery, idle sleep and onboarding instructions."><Loaded {...resource} retry={resource.refresh}>{result => <PolicyForm initial={result.data}/>}</Loaded></Page>;
}
export function Audit() {
  const resource = useResource(operations.audit, {}, location.search);
  return <Page title="Activity" description="Recorded management actions and results." action={<button onClick={resource.refresh}>Refresh</button>}><Loaded {...resource} retry={resource.refresh}>{page => <>
    {page.data.length ? <div className="table-wrap"><table aria-label="Management activity"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Outcome</th><th>Details</th></tr></thead><tbody>{page.data.map(item => <tr key={item.auditId}>
      <td>{timestamp(item.createdAt)}</td><td>{item.actor ? <><strong>{item.actor.displayName}</strong><span className="subline">{item.actor.matrixUserId}</span></> : item.actorKind === 'controller' ? 'Fleet controller' : item.actorKind === 'system' ? 'System' : 'Unidentified actor'}</td><td><strong>{auditActionLabel(item.action)}</strong>{item.target && <span className="subline">{item.target.displayName}</span>}</td><td><Status value={item.outcome}/></td><td><details className="audit-details"><summary>View details</summary><p>{item.message}</p><dl><dt>Action</dt><dd className="mono">{item.action}</dd><dt>Actor</dt><dd className="mono">{item.actorPrincipalId ?? item.actorCredentialId ?? item.actorKind}</dd><dt>Target</dt><dd className="mono">{item.targetKind}: {item.targetId}</dd><dt>Request</dt><dd className="mono">{item.requestId}</dd><dt>Permission</dt><dd>{item.permissionCode ?? '—'}</dd><dt>Room</dt><dd>{item.roomId ?? '—'}</dd></dl></details></td>
    </tr>)}</tbody></table></div> : <Empty title="No activity">Management actions will appear here.</Empty>}<Pagination meta={page.meta}/></>}</Loaded></Page>;
}
