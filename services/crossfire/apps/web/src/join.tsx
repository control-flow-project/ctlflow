import { call, operations, useAction } from './api.js';
import { AccountPage, Alert } from './ui.js';
import { useBackend } from './backend.js';
export function Join({ id, secret }: { id: string; secret: string }) {
  const action = useAction();
  const backend = useBackend();
  return <AccountPage title="You’re invited"><p>This private link lets you create one account for chat and crossfire management.</p>
    <ol className="signup-steps">{backend.signupInstructions.map((instruction, position) => <li key={position}>{instruction}</li>)}</ol>
    <Alert>{!secret ? 'Open the complete private invitation link you received.' : action.error}</Alert>
    <button className="primary" disabled={!secret || action.pending} onClick={() => { void action.run(() => call(operations.claimInvitation,
      { invitationId: id }, { claimSecret: secret }), () => location.assign(backend.signupUrl)); }}>Continue to {backend.label} →</button>
  </AccountPage>;
}
