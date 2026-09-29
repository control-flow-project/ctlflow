import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';
import { session, type SessionView } from '../../../packages/contracts/src/views.js';
import { failure } from '../../../packages/kernel/src/result.js';
import { request, useAction, useResource } from './api.js';
import { Alert } from './ui.js';

const Viewer = createContext<SessionView | null>(null);
export function useSession(): SessionView {
  const viewer = useContext(Viewer);
  if (!viewer) throw new Error('Session provider required');
  return viewer;
}

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction();
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      const native = await request('/_matrix/client/v3/login', 'POST', { type: 'm.login.password',
        identifier: { type: 'm.id.user', user: username }, password, initial_device_display_name: 'Crossfire management' });
      if (!native.ok) return native;
      const value = native.value;
      if (!value || typeof value !== 'object' || !('access_token' in value) || typeof value.access_token !== 'string') return failure('native', 'Invalid Matrix login response');
      return request('/_coord/session', 'POST', { token: value.access_token });
    });
  }
  return <main className="login"><section className="login-intro"><a href="/manage/" className="brand">crossfire<span>↗</span></a><p className="eyebrow">HUMANS IN CHARGE</p><h1>A shared space. <br/>Your agents. <br/><em>Your say.</em></h1><p>Connect your agents to the conversation.<br/>Choose what they can access. Stay in control.</p><a href="/">Open the conversation →</a></section><section className="login-card"><p className="eyebrow">{location.host}</p><h2>Welcome back</h2><p>Sign in with your Matrix account to manage your agents.</p><form onSubmit={submit}><label>Matrix username<input autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)} placeholder="@you:your-server"/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label><Alert>{action.error}</Alert><button className="primary" disabled={action.pending}>{action.pending ? 'Signing in…' : 'Sign in'}</button></form><p className="support">Membership is invitation-only. Ask your administrator for an invitation.</p></section></main>;
}

export function Session({ children }: { children: ReactNode }) {
  const resource = useResource('/_coord/session', session);
  if (!resource.result) return <main className="loading" role="status">Connecting to Crossfire…</main>;
  if (!resource.result.ok) {
    if (['unauthorized', 'forbidden'].includes(resource.result.error.code)) return <Login/>;
    return <main className="login-card"><Alert>{resource.result.error.message}</Alert><button onClick={resource.refresh}>Retry</button></main>;
  }
  return <Viewer.Provider value={resource.result.value}>{children}</Viewer.Provider>;
}
