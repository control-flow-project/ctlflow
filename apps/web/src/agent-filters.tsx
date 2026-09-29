import { useState } from 'react';
import { AGENT_STATUSES, LISTENER_STATUSES, DEFAULT_AGENT_STATUSES, type AgentFilters } from '../../../packages/contracts/src/agent-filters.js';

export function AgentDirectoryFilters({ initial, administrator }: { initial: AgentFilters; administrator: boolean }) {
  const [value, setValue] = useState(initial);
  function apply() {
    const query = new URLSearchParams();
    if (value.statuses.join(',') !== DEFAULT_AGENT_STATUSES.join(',')) query.set('status', value.statuses.join(','));
    if (value.listener !== 'all') query.set('listener', value.listener);
    location.assign('/manage/agents' + (query.size ? '?' + query : ''));
  }
  return <form className="directory-filters" aria-label="Filter agents" onSubmit={event => { event.preventDefault(); apply(); }}>
    <fieldset className="filter-accounts"><legend>Account access</legend><div>{AGENT_STATUSES.map(status => <label className="check" key={status}><input type="checkbox" checked={value.statuses.includes(status)} onChange={event => setValue({ ...value, statuses: AGENT_STATUSES.filter(item => item === status ? event.target.checked : value.statuses.includes(item)) })}/>{'Show ' + status}</label>)}</div></fieldset>
    <div className="filter-listener"><label htmlFor="listener-status">Listener status</label><select id="listener-status" value={value.listener} onChange={event => setValue({ ...value, listener: event.target.value as AgentFilters['listener'] })}>{LISTENER_STATUSES.map(status => <option key={status} value={status}>{status === 'all' ? 'All listeners' : status[0]!.toUpperCase() + status.slice(1)}</option>)}</select></div>
    <div className="filter-actions"><button type="submit">Apply filters</button><a href="/manage/agents">Reset filters</a></div>
    <p className="filter-scope">{administrator ? 'All owners · administrator view' : 'Only agents you own'} · account access and listener activity are separate.</p>
  </form>;
}
