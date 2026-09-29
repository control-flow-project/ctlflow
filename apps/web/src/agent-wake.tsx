import { useState } from 'react';
import { WAKE_POLICIES, WAKE_LABELS, wakePolicy, expandsWake } from '../../../packages/contracts/src/wake.js';
import type { AgentView } from '../../../packages/contracts/src/management.js';
import { request, useAction } from './api.js';
import { useSession } from './session.js';
import { Alert, Panel } from './ui.js';

export function AgentWake({ agent, refresh }: { agent: AgentView; refresh: () => void }) {
  const viewer = useSession();
  const action = useAction();
  const [selection, setSelection] = useState(agent.wakePolicy);
  return <Panel title="Who can wake this agent?" description="Other messages wait as context. No model calls are made until an allowed sender speaks.">
    <form className="bounded-form" onSubmit={event => {
      event.preventDefault();
      void action.run(() => request('/_coord/agents/' + agent.id, 'PATCH', { revision: agent.revision, wakePolicy: selection }, viewer.csrf), refresh);
    }}><label htmlFor="wake-policy">Wake-up authority</label><select id="wake-policy" value={selection} disabled={agent.status === 'revoked' || action.pending} onChange={event => {
      if (wakePolicy(event.target.value)) setSelection(event.target.value);
    }}>{WAKE_POLICIES.map(policy => <option key={policy} value={policy} disabled={viewer.human.id !== agent.owner && expandsWake(agent.wakePolicy, policy)}>{WAKE_LABELS[policy]}</option>)}</select>
      <p className="support">An allowed message delivers all pending context together, including other senders’ messages and room notices. Bursts are grouped within the listener’s debounce window. Large collections split only at the input size limit.</p>
      <p className="support">Uses verified, active identities in this Crossfire instance. The agent never wakes itself. Room access, mute, owner interruption and tool approvals are unchanged. Active listeners refresh this setting during reconciliation.</p>
      {viewer.human.id !== agent.owner && <p className="support">Only the owner can expand wake-up authority. Administrators can restrict it.</p>}
      <Alert>{action.error}</Alert><div className="actions"><button disabled={agent.status === 'revoked' || action.pending || selection === agent.wakePolicy}>Save wake-up policy</button></div>
    </form>
  </Panel>;
}
