import { useState } from 'react';
import type { WakeRuleDetails } from '@ctlflow/crossfire-contracts/wake-up';
import type { AgentView } from '@ctlflow/crossfire-contracts/schema/response';
import { operations, useResource } from '../api.js';
import { Loaded, Panel, Pagination, PageItems, Empty, timestamp } from '../ui.js';

export function WakeTargets({ selected, onChange, attached }: { selected: string[]; onChange: (ids: string[]) => void; attached: WakeRuleDetails['agents'] }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [known, setKnown] = useState<AgentView[]>([]);
  const query = new URLSearchParams({ page: String(page), pageSize: '20', search, status: 'active,suspended,revoked' });
  const resource = useResource(operations.agents, {}, query.toString());
  function toggle(agent: AgentView, checked: boolean) {
    if (checked) { setKnown(previous => [...previous.filter(item => item.agentId !== agent.agentId), agent]); onChange([...selected, agent.agentId]); }
    else onChange(selected.filter(id => id !== agent.agentId));
  }
  return <Panel title="Attached agents" description="Each selected agent receives the configured message. Room access and chat wake-up rules are unchanged.">
    {selected.length ? <PageItems parameter="attachedPage" items={selected}>{ids => <div className="table-wrap"><table aria-label="Attached agents"><thead><tr><th>Agent</th><th>Owner</th><th>Last delivered</th><th>Assignment</th></tr></thead><tbody>{ids.map(id => {
      const existing = attached.find(agent => agent.agentId === id), agent = known.find(agent => agent.agentId === id);
      return <tr key={id}><td><a className="record-link" href={'/manage/agents/' + id}>{existing?.displayName ?? agent?.displayName ?? id}</a></td><td>{existing?.ownerBackendUserId ?? agent?.owner.backendUserId}</td><td>{existing?.lastDeliveredAt ? timestamp(existing.lastDeliveredAt) : <span className="muted">Not delivered</span>}</td><td><button type="button" onClick={() => onChange(selected.filter(selected => selected !== id))}>Remove</button></td></tr>;
    })}</tbody></table></div>}</PageItems> : <Empty title="No agents attached">Select agents below. A Wake-up without agents sends nothing.</Empty>}
    <label>Find agents<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}/></label>
    <Loaded {...resource} retry={resource.refresh}>{result => <><div className="table-wrap"><table aria-label="Choose agents"><thead><tr><th>Select</th><th>Agent</th><th>Owner</th><th>Account</th></tr></thead><tbody>{result.data.map(agent => <tr key={agent.agentId}><td><input type="checkbox" aria-label={'Attach ' + agent.displayName} checked={selected.includes(agent.agentId)} disabled={!selected.includes(agent.agentId) && (agent.status !== 'active' || agent.owner.status !== 'active' || !agent.allowedActions.includes('configure'))} onChange={event => toggle(agent, event.target.checked)}/></td><td>{agent.displayName}</td><td>{agent.owner.displayName}</td><td>{agent.status}</td></tr>)}</tbody></table></div>
    {!result.data.length && <p className="support">No matching agents.</p>}<Pagination parameter="pickerPage" meta={result.meta} onPage={setPage}/></>}</Loaded>
  </Panel>;
}
