import { useState } from 'react';
import { WAKE_POLICIES, WAKE_LABELS, wakePolicy } from '@crossfire/contracts/wake';
import type { AgentView } from '@crossfire/contracts/schema/response';
import type { OutputOf } from '@crossfire/contracts/rest/operation';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Field, Loaded, Panel } from './ui.js';

function WakeForm({ agent, initial }: { agent: AgentView; initial: OutputOf<typeof operations.wakePolicy> }) {
  const viewer = useSession(), action = useAction();
  const [mode, setMode] = useState(initial.mode), [senders, setSenders] = useState(initial.senders);
  const [search, setSearch] = useState(''), [kind, setKind] = useState('all'), [page, setPage] = useState(1);
  const query = new URLSearchParams({ search, kind, excludeId: agent.agentId, page: String(page), pageSize: '50' });
  const directory = useResource(operations.principals, {}, query.toString());
  const senderIds = senders.map(sender => sender.principalId);
  const changed = mode !== initial.mode || mode === 'selected' && JSON.stringify([...senderIds].sort()) !== JSON.stringify(initial.senders.map(sender => sender.principalId).sort());
  return <form onSubmit={event => { event.preventDefault(); void action.run(() => call(operations.changeWakePolicy,
    { agentId: agent.agentId }, { expectedRevision: initial.revision, mode, senderIds: mode === 'selected' ? senderIds : [] }, viewer.csrfSecret)); }}>
    <fieldset disabled={!agent.allowedActions.includes('configure') || agent.status === 'revoked' || action.pending}>
      <label htmlFor="wake-policy">Wake-up authority</label><select id="wake-policy" value={mode} onChange={event => { if (wakePolicy(event.target.value)) setMode(event.target.value); }}>
        {WAKE_POLICIES.map(mode => <option key={mode} value={mode}>{WAKE_LABELS[mode]}</option>)}</select>
      {mode === 'selected' && <div className="identity-picker"><div className="filter-bar"><label>Search identities<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}/></label>
        <Field label="Identity type">{id => <select id={id} value={kind} onChange={event => { setKind(event.target.value); setPage(1); }}><option value="all">People &amp; agents</option><option value="human">People</option><option value="agent">Agents</option></select>}</Field></div>
        <p role="status">{senders.length} selected</p><button type="button" onClick={() => setSenders([])}>Clear selection</button>
        <ul aria-label="Selected wake-up identities">{senders.map(sender => <li key={sender.principalId}>{sender.displayName} · {sender.matrixUserId} <button type="button" aria-label={'Remove ' + sender.matrixUserId}
          onClick={() => setSenders(previous => previous.filter(value => value.principalId !== sender.principalId))}>Remove</button></li>)}</ul>
        <Loaded {...directory} retry={directory.refresh}>{result => <><div className="table-wrap"><table><thead><tr><th>Wake</th><th>Identity</th><th>Type</th><th>Owner</th></tr></thead><tbody>
          {result.data.map(identity => <tr key={identity.principalId}><td><input type="checkbox" aria-label={'Allow ' + identity.matrixUserId} checked={senderIds.includes(identity.principalId)}
            onChange={event => setSenders(previous => event.target.checked ? [...previous, identity] : previous.filter(sender => sender.principalId !== identity.principalId))}/></td>
            <td><strong>{identity.displayName}</strong><span className="subline">{identity.matrixUserId}</span></td><td>{identity.kind}</td><td>{identity.ownerMatrixId}</td></tr>)}</tbody></table></div>
          <div className="pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button type="button" disabled={page >= (result.meta.totalPages ?? 0)} onClick={() => setPage(page + 1)}>Next</button></div></>}</Loaded>
      </div>}
      <p className="support">An allowed message delivers all pending context together. Nobody disables chat-triggered input; use the runtime directly. Unread context remains available.</p>
      <p className="support">Explicitly addressed, blocked messages receive a short owner-named notice at most once per sender every ten minutes. Filtering and notices never call the model.</p>
      <Alert>{action.error}</Alert><div className="actions"><button disabled={!changed}>Save wake-up policy</button></div>
    </fieldset></form>;
}
export function AgentWake({ agent }: { agent: AgentView }) {
  const resource = useResource(operations.wakePolicy, { agentId: agent.agentId });
  return <Panel title="Who can wake this agent?" description="Choose who triggers automatic delivery. Other messages wait as context.">
    <Loaded {...resource} retry={resource.refresh}>{result => <WakeForm agent={agent} initial={result.data}/>}</Loaded>
  </Panel>;
}
