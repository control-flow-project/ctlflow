import { useState } from 'react';
import { call, operations, useAction } from './api.js';
import { HUMAN_SIGNUP } from '@crossfire/contracts/policy';
import { AccountPage, Alert } from './ui.js';

export function Join({ id, secret }: { id: string; secret: string }) {
  const [username, setUsername] = useState('');
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [created, setCreated] = useState(false);
  const action = useAction();
  return <AccountPage title={created ? 'Account created' : 'Create account'}>{created ? <><p>Sign in with your new Matrix account.</p><div className="actions"><a className="button primary" href="/manage/">Sign in →</a></div></> : <>
    <p>This invitation creates an account on this Matrix server.</p>
    <form onSubmit={event => { event.preventDefault(); void action.run(() => call(operations.acceptInvitation, { invitationId: id }, { claimSecret: secret, username, password, displayName: label }), () => setCreated(true)); }}>
      <label>Username<input autoComplete="username" required pattern={HUMAN_SIGNUP.usernamePattern} maxLength={HUMAN_SIGNUP.usernameMax} value={username} onChange={event => setUsername(event.target.value)}/></label>
      <label>Display name<input required maxLength={HUMAN_SIGNUP.labelMax} value={label} onChange={event => setLabel(event.target.value)}/></label>
      <label>Password<input autoComplete="new-password" type="password" required minLength={HUMAN_SIGNUP.passwordMin} maxLength={HUMAN_SIGNUP.passwordMax} value={password} onChange={event => setPassword(event.target.value)}/></label>
      <Alert>{!secret ? 'The invitation secret is missing. Open the complete private link you received.' : action.error}</Alert>
      <button className="primary" disabled={!secret || action.pending}>Create account</button></form></>}</AccountPage>;
}
