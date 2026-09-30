import { useState } from 'react';
import type { MemberView, PolicyView } from '@crossfire/contracts/schema/response';
import { POLICY_LIMITS, DEFAULT_AGENT_INSTRUCTIONS, AGENT_INSTRUCTIONS_MAX_BYTES } from '@crossfire/contracts/policy';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Field, Loaded, Page, Panel, Pagination, Status, applied, timestamp } from './ui.js';

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
    <Loaded {...resource} retry={resource.refresh}>{page => <><div className="table-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>Account</th><th>Enforcement</th><th>Actions</th></tr></thead>
      <tbody>{page.data.map(item => <MemberRow key={item.memberId} item={item}/>)}</tbody></table></div><Pagination meta={page.meta}/></>}</Loaded></Page>;
}
export function Invitations() {
  const viewer = useSession(), resource = useResource(operations.invitations, {}, location.search), action = useAction();
  const [roleCode, setRole] = useState<'member' | 'administrator'>('member'), [lifetime, setLifetime] = useState(86400), [link, setLink] = useState('');
  return <Page title="Invitations" description="One-use account signup links."><Panel title="Create an invitation"><form onSubmit={event => {
    event.preventDefault(); void action.run(() => call(operations.createInvitation, {}, { roleCode, expiresSeconds: lifetime }, viewer.csrfSecret), value => { setLink(value.signupUrl); resource.refresh(); });
  }}><div className="form-row"><Field label="Role">{id => <select id={id} value={roleCode} onChange={event => setRole(event.target.value === 'administrator' ? 'administrator' : 'member')}><option value="member">Member</option><option value="administrator">Administrator</option></select>}</Field>
    <label>Expires in seconds<input type="number" min={60} max={604800} required value={lifetime} onChange={event => setLifetime(Number(event.target.value))}/></label><button disabled={action.pending}>Create invitation</button></div><Alert>{action.error}</Alert></form>
    {link && <label className="secret-link">Share this private link once<input readOnly value={link} onFocus={event => event.target.select()}/><span className="support">Send it privately to the intended person.</span></label>}</Panel>
    <Loaded {...resource} retry={resource.refresh}>{page => <>{page.data.length ? <div className="table-wrap"><table><thead><tr><th>Invitation</th><th>Role</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead><tbody>{page.data.map(item => {
      const state = item.revokedAt !== null ? 'Revoked' : item.consumedByMemberId ? 'Used' : item.expiresAt <= Date.now() ? 'Expired' : 'Active';
      return <tr key={item.invitationId}><td className="mono">{item.invitationId}</td><td>{item.roleCode}</td><td>{timestamp(item.expiresAt)}</td><td><Status value={state}/></td><td>{state === 'Active' && <button disabled={action.pending} onClick={() => {
        if (confirm('Revoke this signup invitation?')) void action.run(() => call(operations.revokeInvitation, { invitationId: item.invitationId }, {}, viewer.csrfSecret));
      }}>Revoke</button>}</td></tr>;
    })}</tbody></table></div> : <Empty title="No invitations">Create an invitation to let someone register on this server.</Empty>}<Pagination meta={page.meta}/></>}</Loaded></Page>;
}
function PolicyForm({ initial }: { initial: PolicyView }) {
  const viewer = useSession(), [value, setValue] = useState(initial), action = useAction();
  const fields: { key: keyof typeof POLICY_LIMITS; label: string }[] = [
    { key: 'maxOwnerAgents', label: 'Agents per owner' }, { key: 'maxAgents', label: 'Agents across this instance' },
    { key: 'maxPending', label: 'Pending enrollment requests' }, { key: 'enrollmentSeconds', label: 'Enrollment lifetime (seconds)' },
    { key: 'reconcileSeconds', label: 'Permission reconciliation (seconds)' },
  ];
  const instructionBytes = new TextEncoder().encode(value.agentInstructions).length;
  return <form onSubmit={event => { event.preventDefault(); const { revision, ...settings } = value; void action.run(() => call(operations.changePolicy, {}, { ...settings, expectedRevision: revision }, viewer.csrfSecret)); }}>
    <Panel title="Instance limits"><div className="bounded-form">{fields.map(field => <label key={field.key}>{field.label}<input type="number" min={POLICY_LIMITS[field.key].min} max={POLICY_LIMITS[field.key].max} required disabled={action.pending} value={value[field.key]} onChange={event => setValue({ ...value, [field.key]: Number(event.target.value) })}/></label>)}</div></Panel>
    <Panel title="Agent onboarding instructions"><div className="bounded-form"><p>Additional instance-wide guidance. Only system administrators can change it.</p>
      <Field label="Additional agent instructions">{id => <textarea id={id} rows={8} disabled={action.pending} value={value.agentInstructions} onChange={event => setValue({ ...value, agentInstructions: event.target.value })}/>}</Field>
      <p className="support">{instructionBytes} / {AGENT_INSTRUCTIONS_MAX_BYTES} UTF-8 bytes. Plain text only; no secrets. Applies to future copied connection messages.</p>
      <button type="button" disabled={action.pending || value.agentInstructions === DEFAULT_AGENT_INSTRUCTIONS} onClick={() => setValue({ ...value, agentInstructions: DEFAULT_AGENT_INSTRUCTIONS })}>Reset to default</button>
      <p className="support">Save settings to apply your edits or reset for everyone.</p></div></Panel><Alert>{action.error}</Alert><button disabled={action.pending || instructionBytes > AGENT_INSTRUCTIONS_MAX_BYTES}>Save settings</button></form>;
}
export function Settings() {
  const resource = useResource(operations.policy, {});
  return <Page title="Instance settings" description="Account limits, permission reconciliation and agent instructions."><Loaded {...resource} retry={resource.refresh}>{result => <PolicyForm initial={result.data}/>}</Loaded></Page>;
}
export function Audit() {
  const resource = useResource(operations.audit, {}, location.search);
  return <Page title="Activity" description="Recorded management actions and results." action={<button onClick={resource.refresh}>Refresh</button>}><Loaded {...resource} retry={resource.refresh}>{page => <>
    {page.data.length ? <div className="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead><tbody>{page.data.map(item => <tr key={item.auditId}>
      <td>{timestamp(item.createdAt)}</td><td className="mono">{item.actorPrincipalId ?? item.actorCredentialId ?? item.actorKind}</td><td><strong>{item.action}</strong><span className="subline"><Status value={item.outcome}/></span></td><td><details><summary className="mono">{item.targetKind}: {item.targetId}</summary><p>{item.message}</p><dl><dt>Request</dt><dd>{item.requestId}</dd><dt>Permission</dt><dd>{item.permissionCode ?? '—'}</dd><dt>Room</dt><dd>{item.roomId ?? '—'}</dd></dl></details></td>
    </tr>)}</tbody></table></div> : <Empty title="No activity">Management actions will appear here.</Empty>}<Pagination meta={page.meta}/></>}</Loaded></Page>;
}
