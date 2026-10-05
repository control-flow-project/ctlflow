import { useState, type Dispatch, type SetStateAction } from 'react';
import { WAKE_POLICIES, WAKE_LABELS, wakePolicy } from '@ctlflow/crossfire-contracts/wake';
import type { AgentView } from '@ctlflow/crossfire-contracts/schema/response';
import type { OutputOf } from '@ctlflow/crossfire-contracts/rest/operation';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Field, Help, Loaded, Panel, Pagination, PageItems } from './ui.js';

type WakeSenders = OutputOf<typeof operations.wakePolicy>['senders'];
function IdentityPicker({ agentId, senders, setSenders }: { agentId: string; senders: WakeSenders; setSenders: Dispatch<SetStateAction<WakeSenders>> }) {
  const [search, setSearch] = useState(''), [kind, setKind] = useState('all'), [page, setPage] = useState(1);
  const query = new URLSearchParams({ search, kind, excludeId: agentId, page: String(page), pageSize: '50' });
  const directory = useResource(operations.principals, {}, query.toString());
  const senderIds = senders.map(sender => sender.principalId);
  return <div className="identity-picker"><div className="filter-bar"><label>Search identities<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}/></label>
    <Field label="Identity type">{id => <select id={id} value={kind} onChange={event => { setKind(event.target.value); setPage(1); }}><option value="all">People &amp; agents</option><option value="human">People</option><option value="agent">Agents</option></select>}</Field></div>
    <div className="identity-selection-heading"><p role="status">{senders.length} selected</p><button type="button" disabled={!senders.length} onClick={() => setSenders([])}>Clear selection</button></div>
    {senders.length > 0 && <PageItems items={senders} parameter="selectedPage">{items => <ul aria-label="Selected wake-up identities">{items.map(sender => <li key={sender.principalId}><div><strong>{sender.displayName}</strong><span className="subline">{sender.matrixUserId}</span></div><button type="button" aria-label={'Remove ' + sender.matrixUserId}
      onClick={() => setSenders(previous => previous.filter(value => value.principalId !== sender.principalId))}>Remove</button></li>)}</ul>}</PageItems>}
    <Loaded {...directory} retry={directory.refresh}>{result => <>{result.data.length ? <div className="table-wrap"><table aria-label="Available wake-up identities"><thead><tr><th>Wake</th><th>Identity</th><th>Type</th><th>Owner</th></tr></thead><tbody>
      {result.data.map(identity => <tr key={identity.principalId}><td><input type="checkbox" aria-label={'Allow ' + identity.matrixUserId} checked={senderIds.includes(identity.principalId)}
        onChange={event => setSenders(previous => event.target.checked ? [...previous, identity] : previous.filter(sender => sender.principalId !== identity.principalId))}/></td>
        <td><strong>{identity.displayName}</strong><span className="subline">{identity.matrixUserId}</span></td><td>{identity.kind === 'human' ? 'Person' : 'Agent'}</td><td>{identity.kind === 'agent' ? identity.ownerMatrixId : '—'}</td></tr>)}</tbody></table></div>
      : <Empty title="No matching identities">Change the search or identity type. Your selected identities are retained.</Empty>}
      <Pagination key={page} meta={{ page, totalPages: result.meta.totalPages ?? 1 }} onPage={setPage}/></>}</Loaded>
  </div>;
}
function WakeForm({ agent, initial }: { agent: AgentView; initial: OutputOf<typeof operations.wakePolicy> }) {
  const viewer = useSession(), action = useAction();
  const [mode, setMode] = useState(initial.mode), [senders, setSenders] = useState(initial.senders);
  const senderIds = senders.map(sender => sender.principalId);
  const changed = mode !== initial.mode || mode === 'selected' && JSON.stringify([...senderIds].sort()) !== JSON.stringify(initial.senders.map(sender => sender.principalId).sort());
  return <form onSubmit={event => { event.preventDefault(); void action.run(() => call(operations.changeWakePolicy,
    { agentId: agent.agentId }, { expectedRevision: initial.revision, mode, senderIds: mode === 'selected' ? senderIds : [] }, viewer.csrfSecret)); }}>
    <fieldset disabled={!agent.allowedActions.includes('configure') || agent.status === 'revoked' || action.pending}>
      <label htmlFor="wake-policy">Wake-up authority</label><select id="wake-policy" value={mode} onChange={event => { if (wakePolicy(event.target.value)) setMode(event.target.value); }}>
        {WAKE_POLICIES.map(mode => <option key={mode} value={mode}>{WAKE_LABELS[mode]}</option>)}</select>
      {mode === 'selected' && <IdentityPicker agentId={agent.agentId} senders={senders} setSenders={setSenders}/>}
      <Help title="Context and blocked messages"><p>An allowed message delivers all pending context together. Nobody disables chat-triggered input; use the runtime directly. Unread context remains available.</p>
        <p>Explicitly addressed, blocked messages receive a short owner-named notice at most once per sender every ten minutes. Filtering and notices never call the model.</p></Help>
      <Alert>{action.error}</Alert><div className="actions"><button disabled={!changed}>Save wake-up policy</button></div>
    </fieldset></form>;
}
export function AgentWake({ agent }: { agent: AgentView }) {
  const resource = useResource(operations.wakePolicy, { agentId: agent.agentId });
  return <Panel title="Who can wake this agent?" description="Choose who triggers automatic delivery. Other messages wait as context.">
    <Loaded {...resource} retry={resource.refresh}>{result => <WakeForm agent={agent} initial={result.data}/>}</Loaded>
  </Panel>;
}
