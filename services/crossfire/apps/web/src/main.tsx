import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Session, useSession } from './session.js';
import { Agents, AgentDetail } from './agents.js';
import { AgentRoomDetail } from './agent-rooms.js';
import { Enrollments, Connect } from './enrollments.js';
import { Members, Invitations, Settings, Audit } from './administration.js';
import { Join } from './join.js';
import { Rooms, RoomMembers } from './rooms.js';
import { Alert, Empty, Page } from './ui.js';
import { request, useAction } from './api.js';
import './style.css';

const path = location.pathname.replace(/\/$/u, '');
const sections = [
  { path: '/manage/agents', label: 'Agents', icon: '◉' },
  { path: '/manage/enrollments', label: 'Enrollments', icon: '↗' },
  { path: '/manage/connect', label: 'Connect an agent', icon: '+' },
  { path: '/manage/audit', label: 'Activity', icon: '≡' },
];
const administration = [
  { path: '/manage/rooms', label: 'Rooms', icon: '#' },
  { path: '/manage/members', label: 'Members', icon: '◎' },
  { path: '/manage/invitations', label: 'Invitations', icon: '◇' },
  { path: '/manage/policy', label: 'Settings', icon: '⊞' },
];
function Route() {
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
  if (path === '/manage/audit') return <Audit/>;
  if (viewer.human.role === 'administrator') {
    if (path === '/manage/rooms') return <Rooms/>;
    const room = /^\/manage\/rooms\/([^/]+)$/u.exec(path);
    if (room) return <RoomMembers id={decodeURIComponent(room[1]!)}/>;
    if (path === '/manage/members') return <Members/>;
    if (path === '/manage/invitations') return <Invitations/>;
    if (path === '/manage/policy') return <Settings/>;
  }
  return <Page title="Page unavailable" description="This view is not available for your account."><Empty title="Let’s get you back"><a href="/manage/agents">Go to your agents →</a></Empty></Page>;
}
function Shell() {
  const viewer = useSession();
  const action = useAction();
  const admin = viewer.human.role === 'administrator';
  const nav = (items: typeof sections) => items.map(item => <a key={item.path} href={item.path} aria-current={path.startsWith(item.path) || path === '/manage' && item.path === '/manage/agents' ? 'page' : undefined}><span aria-hidden="true">{item.icon}</span>{item.label}</a>);
  return <div className={'shell' + (admin ? ' admin' : '')}><aside className="sidebar"><a className="brand" href="/manage/">crossfire<span>↗</span></a><div className="instance"><span className="instance-dot"/>{location.host}<small>MANAGEMENT</small></div><nav aria-label="Main navigation"><p className="nav-label">WORKSPACE</p>{nav(sections)}{admin && <><p className="nav-label">ADMINISTRATION</p>{nav(administration)}</>}</nav><a className="chat-link" href="/">Open Element <span>↗</span></a><p className="sidebar-note">The conversation belongs to everyone.<br/>The controls belong to you.</p></aside><div className="main-column"><header className="topbar"><span>Human-led coordination</span><div className="viewer"><span className="viewer-avatar">{viewer.human.label.slice(0, 1).toUpperCase()}</span><span>{viewer.human.label}<small>{admin ? 'Administrator' : 'Member'}</small></span><button disabled={action.pending} onClick={() => { void action.run(() => request('/_coord/session', 'DELETE', {}, viewer.csrf), () => location.assign('/manage/')); }}>Sign out</button></div></header><main className="content"><Alert>{action.error}</Alert><Route/></main><footer className="page-footer">Crossfire <span>Explicit access. Human ownership.</span></footer></div></div>;
}
const join = /^\/manage\/join\/([a-f0-9-]{36})$/u.exec(path);
createRoot(document.getElementById('root')!).render(<StrictMode>{join ? <Join id={join[1]!}/> : <Session><Shell/></Session>}</StrictMode>);
