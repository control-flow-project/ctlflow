import { useState } from 'react';
import { WAKE_POLICIES, WAKE_LABELS, wakePolicy } from '../../../packages/contracts/src/wake.js';
import type { AgentView } from '../../../packages/contracts/src/management.js';
import { parseIdentities } from '../../../packages/contracts/src/identities.js';
import { request, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Loaded, Panel } from './ui.js';

export function AgentWake({ agent, refresh }: { agent: AgentView; refresh: () => void }) {
  const viewer = useSession();
  const action = useAction();
  const [selection, setSelection] = useState(agent.wakePolicy);
  const [senders, setSenders] = useState(agent.wakeSenders);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [limit, setLimit] = useState(50);
  const directory = useResource('/_coord/agents/' + agent.id + '/wake-authors', parseIdentities);
  const changed = selection !== agent.wakePolicy || selection === 'selected' && JSON.stringify([...senders].sort()) !== JSON.stringify([...agent.wakeSenders].sort());
  return <Panel title="Who can wake this agent?" description="Choose who can trigger automatic chat delivery. Other messages wait as context.">
    <form onSubmit={event => {
      event.preventDefault();
      void action.run(() => request('/_coord/agents/' + agent.id, 'PATCH', { revision: agent.revision, wakePolicy: selection,
        ...(selection === 'selected' ? { wakeSenders: senders } : {}) }, viewer.csrf), refresh);
    }}><fieldset disabled={agent.status === 'revoked' || action.pending}>
      <label htmlFor="wake-policy">Wake-up authority</label><select id="wake-policy" value={selection} onChange={event => {
        if (wakePolicy(event.target.value)) setSelection(event.target.value);
      }}>{WAKE_POLICIES.map(policy => <option key={policy} value={policy}>{WAKE_LABELS[policy]}</option>)}</select>
      {selection === 'selected' && <Loaded result={directory.result} retry={directory.refresh}>{identities => {
        const visible = identities.filter(identity => (kind === 'all' || kind === identity.kind)
          && [identity.id, identity.label, identity.owner].some(value => value.toLowerCase().includes(search.toLowerCase())));
        return <div className="identity-picker">
          <div className="filter-bar"><label>Search identities<input type="search" value={search} onChange={event => { setSearch(event.target.value); setLimit(50); }}/></label>
            <label>Identity type<select value={kind} onChange={event => { setKind(event.target.value); setLimit(50); }}><option value="all">People &amp; agents</option><option value="human">People</option><option value="agent">Agents</option></select></label></div>
          <p role="status">{senders.length} selected · {visible.length} matching identities</p>
          <ul aria-label="Selected wake authors" className="identity-selection">{senders.map(id => <li key={id}><span>{identities.find(identity => identity.id === id)?.label ?? 'Unavailable identity'} <code>{id}</code></span><button type="button" aria-label={'Remove ' + id} onClick={() => setSenders(previous => previous.filter(sender => sender !== id))}>Remove</button></li>)}</ul>
          <div className="table-wrap"><table><thead><tr><th>Wake</th><th>Identity</th><th>Type</th><th>Owner</th></tr></thead><tbody>{visible.slice(0, limit).map(identity => <tr key={identity.id}>
            <td><input type="checkbox" aria-label={'Allow ' + identity.id} checked={senders.includes(identity.id)} onChange={event => setSenders(previous => event.target.checked ? [...previous, identity.id] : previous.filter(id => id !== identity.id))}/></td>
            <td><strong>{identity.label}</strong><span className="subline">{identity.id}</span></td><td>{identity.kind === 'human' ? 'Person' : 'Agent'}</td><td className="mono">{identity.owner}</td>
          </tr>)}</tbody></table></div>
          {visible.length > limit && <button type="button" onClick={() => setLimit(previous => previous + 50)}>Show more identities</button>}
          <p className="support">Only checked identities can wake this agent. Include the owner explicitly if desired. An empty selection wakes nobody.</p>
        </div>;
      }}</Loaded>}
      <p className="support">An allowed message delivers all pending context together, including other senders’ messages and room notices. Bursts are grouped within the listener’s debounce window. Large collections split only at the input size limit.</p>
      <p className="support">Nobody disables all chat-triggered input, including owner and urgent messages. Use the agent’s TUI directly or another native input method. Pending chat context stays unread until automatic delivery is enabled.</p>
      <p className="support">Uses verified, active identities in this Crossfire instance. The agent never wakes itself. Room access, mute, owner interruption, tool approvals and listener heartbeats are unchanged. Active listeners refresh this setting during reconciliation.</p>
      <Alert>{action.error}</Alert><div className="actions"><button disabled={!changed}>Save wake-up policy</button></div>
    </fieldset></form>
  </Panel>;
}
