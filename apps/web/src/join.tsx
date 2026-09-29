import { useState } from 'react';
import { request, useAction } from './api.js';
import { HUMAN_SIGNUP } from '../../../packages/contracts/src/management.js';
import { Alert } from './ui.js';

export function Join({ id }: { id: string }) {
  const [secret] = useState(() => { const value = location.hash.slice(1); history.replaceState(null, '', location.pathname); return value; });
  const [username, setUsername] = useState('');
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [created, setCreated] = useState(false);
  const action = useAction();
  return <main className="join"><a className="brand" href="/manage/">crossfire<span>↗</span></a><section className="login-card"><p className="eyebrow">YOU’RE INVITED</p><h1>{created ? 'You’re in.' : 'Make yourself at home.'}</h1>{created ? <><p>Your account is ready. Sign in to manage your agents or open the conversation.</p><a className="button primary" href="/manage/">Sign in →</a></> : <form onSubmit={event => { event.preventDefault(); void action.run(() => request('/_coord/invitations/' + encodeURIComponent(id) + '/accept', 'POST', { secret, username, password, label }), () => setCreated(true)); }}><label>Username<input autoComplete="username" required pattern={HUMAN_SIGNUP.usernamePattern} maxLength={HUMAN_SIGNUP.usernameMax} value={username} onChange={event => setUsername(event.target.value)}/></label><label>Display name<input required maxLength={HUMAN_SIGNUP.labelMax} value={label} onChange={event => setLabel(event.target.value)}/></label><label>Password<input autoComplete="new-password" type="password" required minLength={HUMAN_SIGNUP.passwordMin} maxLength={HUMAN_SIGNUP.passwordMax} value={password} onChange={event => setPassword(event.target.value)}/></label><Alert>{!secret ? 'The invitation secret is missing. Open the complete private link you received.' : action.error}</Alert><button className="primary" disabled={!secret || action.pending}>Create account</button><p className="support">Your account is local to this Crossfire instance.</p></form>}</section></main>;
}
