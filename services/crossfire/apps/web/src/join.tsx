import { call, operations, useAction } from './api.js';
import { AccountPage, Alert } from './ui.js';
export function Join({ id, secret }: { id: string; secret: string }) {
  const action = useAction();
  return <AccountPage title="You’re invited"><p>Create your account in Element. Choose your own username and password; this private invitation authorizes one signup.</p>
    <p>Choose your username and password in Element, then select “Start authentication”. Confirm your invitation in the window it opens and return to Element.</p>
    <p>Use the same account for chat and Crossfire management.</p>
    <Alert>{!secret ? 'Open the complete private invitation link you received.' : action.error}</Alert>
    <button className="primary" disabled={!secret || action.pending} onClick={() => { void action.run(() => call(operations.claimInvitation,
      { invitationId: id }, { claimSecret: secret }), () => location.assign('/#/register')); }}>Continue to Element →</button>
  </AccountPage>;
}
