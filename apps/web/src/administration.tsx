import { useState } from 'react';
import { member, invitation, audit, pageOf, type InvitationView } from '../../../packages/contracts/src/views.js';
import { policy, type MemberView, type Policy, type Role, object, text, POLICY_LIMITS, INVITATION_LIFETIME, DEFAULT_AGENT_INSTRUCTIONS, AGENT_INSTRUCTIONS_MAX_BYTES } from '../../../packages/contracts/src/management.js';
import { failure, success } from '../../../packages/contracts/src/result.js';
import { request, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Loaded, Page, Panel, Pagination, Status, applied, timestamp } from './ui.js';

const members = pageOf(member), invitations = pageOf(invitation), events = pageOf(audit);
function MemberRow({ item }: { item: MemberView }) {
  const viewer = useSession();
  const action = useAction();
  const mutate = (change: { role?: Role; status?: string }) => request('/_coord/members/' + encodeURIComponent(item.id), 'PATCH', { revision: item.revision, ...change }, viewer.csrf);
  return <tr><td><strong>{item.label}</strong><span className="subline mono">{item.id}</span></td><td><select aria-label={'Role for ' + item.id} value={item.role} disabled={action.pending || item.status === 'revoked'} onChange={event => { const role = event.target.value as Role; if (confirm('Change this member’s role to ' + role + '?')) void action.run(() => mutate({ role })); }}><option value="member">Member</option><option value="administrator">Administrator</option></select></td><td><Status value={item.status}/></td><td><Status value={applied(item)}/><Alert>{item.error}</Alert></td><td>{item.status !== 'revoked' && <div className="actions"><button disabled={action.pending} onClick={() => { if (confirm('Change access for this member and their agents?')) void action.run(() => mutate({ status: item.status === 'active' ? 'suspended' : 'active' })); }}>{item.status === 'active' ? 'Suspend' : 'Reactivate'}</button><button className="danger" disabled={action.pending} onClick={() => { if (confirm('Permanently revoke this member and their agents?')) void action.run(() => mutate({ status: 'revoked' })); }}>Revoke</button></div>}<Alert>{action.error}</Alert></td></tr>;
}
export function Members() {
  const resource = useResource('/_coord/members' + location.search, members);
  return <Page title="Members" description="People, roles and account access across this instance." action={<a className="button primary" href="/manage/invitations">Invite a member ↗</a>}><Loaded {...resource} retry={resource.refresh}>{data => <><div className="panel table-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>Account</th><th>Enforcement</th><th>Actions</th></tr></thead><tbody>{data.items.map(item => <MemberRow key={item.id} item={item}/>)}</tbody></table></div><Pagination next={data.next}/></>}</Loaded></Page>;
}

function InvitationRow({ item }: { item: InvitationView }) {
  const { csrf } = useSession();
  const action = useAction();
  const state = item.revoked ? 'Revoked' : item.used ? 'Used' : item.expires <= Date.now() ? 'Expired' : 'Active';
  return <tr><td className="mono">{item.id}</td><td>{item.role}</td><td>{timestamp(item.expires)}</td><td><Status value={state}/></td><td>{state === 'Active' && <button disabled={action.pending} onClick={() => { void action.run(() => request('/_coord/invitations/' + item.id, 'DELETE', {}, csrf)); }}>Revoke</button>}<Alert>{action.error}</Alert></td></tr>;
}
export function Invitations() {
  const viewer = useSession();
  const resource = useResource('/_coord/invitations' + location.search, invitations);
  const action = useAction();
  const [role, setRole] = useState<Role>('member');
  const [lifetime, setLifetime] = useState<number>(INVITATION_LIFETIME.default);
  const [link, setLink] = useState('');
  return <Page title="Invitations" description="One-use links for people you want in this space."><Panel title="Invite someone"><form onSubmit={event => { event.preventDefault(); void action.run(async () => { const result = await request('/_coord/invitations', 'POST', { role, expiresSeconds: lifetime }, viewer.csrf); if (!result.ok) return result; const parsed = object(result.value); return parsed.ok && text(parsed.value.id, 36) && text(parsed.value.secret, 100) ? success(location.origin + '/manage/join/' + encodeURIComponent(parsed.value.id) + '#' + parsed.value.secret) : failure('native', 'Invalid invitation response'); }, value => { setLink(String(value)); resource.refresh(); }); }}><div className="form-row"><label>Role<select value={role} onChange={event => setRole(event.target.value as Role)}><option value="member">Member</option><option value="administrator">Administrator</option></select></label><label>Expires in seconds<input type="number" min={INVITATION_LIFETIME.min} max={INVITATION_LIFETIME.max} required value={lifetime} onChange={event => setLifetime(Number(event.target.value))}/></label><button className="primary" disabled={action.pending}>Create invitation</button></div><Alert>{action.error}</Alert></form>{link && <label className="secret-link">Share this private link once<input readOnly value={link} onFocus={event => event.target.select()}/><span className="support">The secret is only shown now. Send it privately to the intended person.</span></label>}</Panel><Loaded {...resource} retry={resource.refresh}>{data => <>{data.items.length ? <div className="panel table-wrap"><table><thead><tr><th>Invitation</th><th>Role</th><th>Expires</th><th>Status</th><th/></tr></thead><tbody>{data.items.map(item => <InvitationRow key={item.id} item={item}/>)}</tbody></table></div> : <Empty title="No invitations yet">Create a private link to welcome your first teammate.</Empty>}<Pagination next={data.next}/></>}</Loaded></Page>;
}

function PolicyForm({ initial }: { initial: Policy }) {
  const { csrf } = useSession();
  const [value, setValue] = useState(initial);
  const action = useAction();
  const fields: { key: keyof typeof POLICY_LIMITS; label: string }[] = [
    { key: 'maxOwnerAgents', label: 'Agents per owner' },
    { key: 'maxAgents', label: 'Agents across this instance' },
    { key: 'maxPending', label: 'Pending enrollment requests' },
    { key: 'enrollmentSeconds', label: 'Enrollment lifetime (seconds)' },
    { key: 'reconcileSeconds', label: 'Permission reconciliation (seconds)' },
  ];
  const instructionBytes = new TextEncoder().encode(value.agentInstructions).length;
  return <form onSubmit={event => { event.preventDefault(); void action.run(() => request('/_coord/policy', 'PATCH', value, csrf)); }}>
    <Panel title="Instance limits"><div className="bounded-form">{fields.map(field => <label key={field.key}>{field.label}<input type="number" min={POLICY_LIMITS[field.key].min} max={POLICY_LIMITS[field.key].max} required disabled={action.pending} value={value[field.key]} onChange={event => setValue({ ...value, [field.key]: Number(event.target.value) })}/></label>)}</div><p className="support">A periodic sweep lowers agent access when an owner loses access elsewhere. Pending and failed changes remain visible until Matrix confirms them.</p></Panel>
    <Panel title="Agent onboarding instructions"><div className="bounded-form">
      <p>Add instance-wide guidance to the message people copy from Connect an agent. Only system administrators can change this section.</p>
      <div className="textarea-field"><label htmlFor="agent-instructions">Additional agent instructions</label><textarea id="agent-instructions" rows={8} maxLength={AGENT_INSTRUCTIONS_MAX_BYTES} disabled={action.pending} value={value.agentInstructions} onChange={event => setValue({ ...value, agentInstructions: event.target.value })} placeholder="For example: Keep replies concise and use the project’s issue tracker for task updates." aria-describedby="agent-instructions-help agent-instructions-length"/></div>
      <p id="agent-instructions-length" className="support">{instructionBytes} / {AGENT_INSTRUCTIONS_MAX_BYTES} UTF-8 bytes</p>
      <p id="agent-instructions-help" className="support">Default: no additional instructions. Plain text only; do not include secrets. Server URLs, identity and verified installation commands are always generated separately. Changes apply to future copied messages, not existing agents.</p>
      <button type="button" disabled={action.pending || value.agentInstructions === DEFAULT_AGENT_INSTRUCTIONS} onClick={() => setValue({ ...value, agentInstructions: DEFAULT_AGENT_INSTRUCTIONS })}>Reset to default</button>
      <p className="support">Save settings to apply your edits or reset for everyone.</p>
    </div></Panel>
    <Alert>{action.error}</Alert><button className="primary" disabled={action.pending || instructionBytes > AGENT_INSTRUCTIONS_MAX_BYTES}>Save settings</button>
  </form>;
}
export function Settings() {
  const resource = useResource('/_coord/policy', policy);
  return <Page title="Instance settings" description="Enrollment, permission reconciliation and administrator-owned agent guidance."><Loaded {...resource} retry={resource.refresh}>{value => <PolicyForm initial={value}/>}</Loaded></Page>;
}
export function Audit() {
  const resource = useResource('/_coord/audit' + location.search, events);
  return <Page title="Activity" description="A record of management decisions, their owners and results." action={<button onClick={resource.refresh}>Refresh</button>}><Loaded {...resource} retry={resource.refresh}>{data => <>{data.items.length ? <div className="panel table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{timestamp(item.created)}</td><td className="mono">{item.actor}</td><td>{item.action}</td><td><details><summary className="mono">{item.target}</summary><pre>{item.detail}</pre></details></td></tr>)}</tbody></table></div> : <Empty title="A fresh start">Management decisions will appear here.</Empty>}<Pagination next={data.next} parameter="before"/></>}</Loaded></Page>;
}
