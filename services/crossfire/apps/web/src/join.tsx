import { call, operations, useAction } from './api.js';
import { AccountPage, Alert } from './ui.js';
export function Join({ id, secret }: { id: string; secret: string }) {
  const action = useAction();
  return <AccountPage title="You’re invited"><p>This private link lets you create one account for chat and Crossfire management.</p>
    <ol className="signup-steps"><li>Continue to Element and choose your username and password.</li><li>Select “Start authentication” and confirm the invitation in the window it opens.</li><li>Return to Element to finish signing up.</li></ol>
    <Alert>{!secret ? 'Open the complete private invitation link you received.' : action.error}</Alert>
    <button className="primary" disabled={!secret || action.pending} onClick={() => { void action.run(() => call(operations.claimInvitation,
      { invitationId: id }, { claimSecret: secret }), () => location.assign('/#/register')); }}>Continue to Element →</button>
  </AccountPage>;
}
