import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Session, useSession } from './session.js';
import { Agents, AgentDetail } from './agents.js';
import { AgentRoomDetail } from './agent-rooms.js';
import { Enrollments } from './enrollments.js';
import { Connect } from './connect.js';
import { Members, Invitations, Settings, Audit } from './administration.js';
import { Fleets, FleetDetail } from './fleets.js';
import { FleetMap } from './fleet-map/index.js';
import { Join } from './join.js';
import { Alert, Page } from './ui.js';
import { call, operations, useAction, useResource } from './api.js';
import './style.css';
import './fleet-map/style.css';

const path = location.pathname.replace(/\/$/u, '');
const sections = [
  { path: '/manage/agents', label: 'Agents', icon: '◉' },
  { path: '/manage/fleets', label: 'Fleets', icon: '▦' },
  { path: '/manage/enrollments', label: 'Enrollments', icon: '↗' },
  { path: '/manage/connect', label: 'Connect an agent', icon: '+' },
  { path: '/manage/audit', label: 'Activity', icon: '≡' },
];
const administration = [
  { path: '/manage/members', label: 'Members', icon: '◎' },
  { path: '/manage/invitations', label: 'Invitations', icon: '◇' },
  { path: '/manage/policy', label: 'Settings', icon: '⊞' },
];
function Route({ canInvite }: { canInvite: boolean }) {
  const viewer = useSession();
  if (path === '/manage' || path === '/manage/agents') return <Agents/>;
  const agent = /^\/manage\/agents\/([a-f0-9-]{36})$/u.exec(path);
  if (agent) return <AgentDetail id={agent[1]!}/>;
  const agentRoom = /^\/manage\/agents\/([a-f0-9-]{36})\/rooms\/([^/]+)$/u.exec(path);
  if (agentRoom) return <AgentRoomDetail id={agentRoom[1]!} room={decodeURIComponent(agentRoom[2]!)}/>;
  if (path === '/manage/enrollments') return <Enrollments/>;
  const enrollment = /^\/manage\/enrollments\/([a-f0-9-]{36})$/u.exec(path);
  if (enrollment) return <Enrollments id={enrollment[1]!}/>;
  if (path === '/manage/connect') return <Connect/>;
  if (path === '/manage/connect/fleet') return <Connect fleet/>;
  if (path === '/manage/invitations' && canInvite) return <Invitations/>;
  if (path === '/manage/audit') return <Audit/>;
  if (path === '/manage/fleets') return <Fleets/>;
  const fleetMap = /^\/manage\/fleets\/([a-f0-9-]{36})\/map$/u.exec(path);
  if (fleetMap) return <FleetMap id={fleetMap[1]!}/>;
  const fleet = /^\/manage\/fleets\/([a-f0-9-]{36})$/u.exec(path);
  if (fleet) return <FleetDetail id={fleet[1]!}/>;
  if (viewer.member.roleCode === 'administrator') {
    if (path === '/manage/members') return <Members/>;
    if (path === '/manage/policy') return <Settings/>;
  }
  return <Page title="Page unavailable" description="This view is not available for your account."><a href="/manage/agents">View agents →</a></Page>;
}
function Shell() {
  const viewer = useSession();
  const action = useAction();
  const admin = viewer.member.roleCode === 'administrator';
  const policy = useResource(operations.policy, {});
  const canInvite = admin || policy.result?.ok === true && policy.result.value.data.invitationIssuers === 'members';
  const nav = (items: typeof sections) => items.map(item => <a key={item.path} href={item.path} aria-current={path.startsWith(item.path) || path === '/manage' && item.path === '/manage/agents' ? 'page' : undefined}><span aria-hidden="true">{item.icon}</span>{item.label}</a>);
  return <div className={'shell' + (admin ? ' admin' : '')}><aside className="sidebar"><a className="brand" href="/manage/">crossfire<span>↗</span></a><div className="instance"><span className="instance-dot"/>{location.host}<small>MANAGEMENT</small></div><nav aria-label="Main navigation"><p className="nav-label">WORKSPACE</p>{nav(sections)}{!admin && canInvite && nav(administration.filter(item => item.path === '/manage/invitations'))}{admin && <><p className="nav-label">ADMINISTRATION</p>{nav(administration)}</>}</nav><a className="chat-link" href="/">Open Element <span>↗</span></a></aside><div className="main-column"><header className="topbar"><span>Management</span><div className="viewer"><span className="viewer-avatar">{viewer.member.displayName.slice(0, 1).toUpperCase()}</span><span>{viewer.member.displayName}<small>{admin ? 'Administrator' : 'Member'}</small></span><button disabled={action.pending} onClick={() => { void action.run(() => call(operations.endSession, {}, {}, viewer.csrfSecret), () => location.assign('/manage/')); }}>Sign out</button></div></header><main className="content"><Alert>{action.error}</Alert><Route canInvite={canInvite}/></main></div></div>;
}
const join = /^\/manage\/join\/([a-f0-9-]{36})$/u.exec(path);
const invitationSecret = join ? location.hash.slice(1) : '';
if (join) history.replaceState(null, '', location.pathname);
createRoot(document.getElementById('root')!).render(<StrictMode>{join ? <Join id={join[1]!} secret={invitationSecret}/> : <Session><Shell/></Session>}</StrictMode>);
