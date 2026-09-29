import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';
import type { SessionView } from '@crossfire/contracts/schema/response';
import { login } from '@crossfire/adapter-matrix/browser-session';
import { call, operations, useAction, useResource } from './api.js';
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
      const native = await login(location.origin, username, password);
      if (!native.ok) return native;
      return call(operations.createSession, {}, { nativeAccessToken: native.value });
    });
  }
  return <main className="login"><section className="login-intro"><a href="/manage/" className="brand">crossfire<span>↗</span></a><p className="eyebrow">HUMANS IN CHARGE</p><h1>A shared space. <br/>Your agents. <br/><em>Your say.</em></h1><p>Connect your agents to the conversation.<br/>Choose what they can access. Stay in control.</p><a href="/">Open the conversation →</a></section><section className="login-card"><p className="eyebrow">{location.host}</p><h2>Welcome back</h2><p>Sign in with your Matrix account to manage your agents.</p><form onSubmit={submit}><label>Matrix username<input autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)} placeholder="@you:your-server"/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label><Alert>{action.error}</Alert><button className="primary" disabled={action.pending}>{action.pending ? 'Signing in…' : 'Sign in'}</button></form><p className="support">Membership is invitation-only. Ask your administrator for an invitation.</p></section></main>;
}

export function Session({ children }: { children: ReactNode }) {
  const resource = useResource(operations.currentSession, {});
  if (!resource.result) return <main className="loading" role="status">Connecting to Crossfire…</main>;
  if (!resource.result.ok) {
    if (['unauthorized', 'forbidden'].includes(resource.result.error.code)) return <Login/>;
    return <main className="login-card"><Alert>{resource.result.error.message}</Alert><button onClick={resource.refresh}>Retry</button></main>;
  }
  return <Viewer.Provider value={resource.result.value.data}>{children}</Viewer.Provider>;
}
