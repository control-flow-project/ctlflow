import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';
import type { SessionView } from '@ctlflow/crossfire-contracts/schema/response';
import { useBackend } from './backend.js';
import { call, operations, useAction, useResource } from './api.js';
import { AccountPage, Alert } from './ui.js';

const Viewer = createContext<SessionView | null>(null);
export function useSession(): SessionView {
  const viewer = useContext(Viewer);
  if (!viewer) throw new Error('Session provider required');
  return viewer;
}

export function Login() {
  const backend = useBackend();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction();
  const signup = useResource(operations.registrationPolicy, {});
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      const native = await call(operations.authenticateBackend, {}, { username, password });
      if (!native.ok) return native;
      return call(operations.createSession, {}, { nativeAccessToken: native.value.accessToken });
    });
  }
  return <AccountPage title="Sign in"><p>Use your {backend.label} account on this server.</p>
    <form onSubmit={submit}><label>Username<input autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)}/></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label>
      <Alert>{action.error}</Alert><button className="primary" disabled={action.pending}>{action.pending ? 'Signing in…' : 'Sign in'}</button></form>
    <p className="support">{signup.result?.ok && signup.result.value.data.signupMode === 'open'
      ? <a href={backend.signupUrl}>Create your account →</a> : 'To create an account, open the private invitation link you received.'}</p></AccountPage>;
}

export function Session({ children }: { children: ReactNode }) {
  const resource = useResource(operations.currentSession, {});
  if (!resource.result) return <main className="loading" role="status">Connecting to crossfire…</main>;
  if (!resource.result.ok) {
    if (['unauthorized', 'forbidden'].includes(resource.result.error.code)) return <Login/>;
    return <AccountPage title="Unable to load your session"><Alert>{resource.result.error.message}</Alert><button onClick={resource.refresh}>Retry</button></AccountPage>;
  }
  return <Viewer.Provider value={resource.result.value.data}>{children}</Viewer.Provider>;
}
