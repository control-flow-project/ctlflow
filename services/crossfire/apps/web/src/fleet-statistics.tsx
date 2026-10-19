import { useState } from 'react';
import { operations, useResource } from './api.js';
import { Empty, Field, Loaded, Panel, Pagination, PageItems, timestamp } from './ui.js';

function bytes(value: number): string {
  return value < 1024 ? value + ' B' : value < 1024 * 1024 ? (value / 1024).toFixed(1) + ' KiB' : (value / (1024 * 1024)).toFixed(1) + ' MiB';
}
export function FleetStatistics({ id }: { id: string }) {
  const parameters = new URLSearchParams(location.search), [hours, setHours] = useState(parameters.get('hours') ?? '24');
  const query = new URLSearchParams([...parameters].filter(([name]) => ['hours', 'page', 'pageSize'].includes(name)));
  query.set('hours', hours);
  const resource = useResource(operations.fleetStatistics, { fleetId: id }, '?' + query.toString());
  return <><div className="filter-bar"><Field label="Period">{fieldId => <select id={fieldId} value={hours} onChange={event => {
    const next = new URLSearchParams(location.search); next.set('hours', event.target.value); next.delete('page');
    setHours(event.target.value); location.assign(location.pathname + '?' + next.toString());
  }}><option value="1">Last hour</option><option value="24">Last day</option><option value="168">Last week</option><option value="720">Last 30 days</option></select>}</Field><button onClick={resource.refresh}>Refresh summaries</button></div>
    <Loaded {...resource} retry={resource.refresh}>{({ data }) => <>
      <Panel title="Traffic" description="Periodic listener summaries; counts are approximate and exclude internal notices."><dl>
        <dt>Observed messages</dt><dd>{data.totals.observed.toLocaleString()}</dd><dt>Delivered to agents</dt><dd>{data.totals.delivered.toLocaleString()}</dd>
        <dt>Observed content</dt><dd>{bytes(data.totals.contentBytes)}</dd><dt>Delivered content</dt><dd>{bytes(data.totals.deliveredBytes)}</dd>
        <dt>Declared attachment sizes</dt><dd>{bytes(data.totals.attachmentBytes)}</dd><dt>Largest message</dt><dd>{bytes(data.totals.largestBytes)}</dd>
        <dt>Latest summary</dt><dd>{data.lastReportAt === null ? 'Not reported yet' : timestamp(data.lastReportAt)}</dd>
        <dt>Untracked samples</dt><dd>{data.dropped.toLocaleString()}</dd></dl><p className="support">Listeners send bounded summaries about every five minutes. crossfire keeps hourly rollups for {data.retentionDays} days. Messages observed by several agents count once per recipient; attachment sizes are declared metadata, not downloads.</p></Panel>
      <Panel title="Agents" description="Message traffic and native token usage for each recipient."><PageItems items={data.agents} parameter="agentPage">{agents => <div className="table-wrap"><table aria-label="Agent statistics"><thead><tr><th>Agent</th><th>Observed</th><th>Delivered</th><th>Content</th><th>Input tokens</th><th>Cached input</th><th>Output tokens</th></tr></thead><tbody>{agents.map(agent => <tr key={agent.agentId}><td><a className="record-link" href={'/manage/agents/' + agent.agentId}>{agent.displayName}</a></td><td>{agent.totals.observed.toLocaleString()}</td><td>{agent.totals.delivered.toLocaleString()}</td><td>{bytes(agent.totals.contentBytes)}</td><td>{agent.tokens?.input.toLocaleString() ?? 'Not reported'}</td><td>{agent.tokens?.cachedInput.toLocaleString() ?? 'Not reported'}</td><td>{agent.tokens?.output.toLocaleString() ?? 'Not reported'}</td></tr>)}</tbody></table></div>}</PageItems></Panel>
      <Panel title="Sender → recipient" description="Who sent messages each agent observed, grouped by room and message type.">{data.flows.length ? <div className="table-wrap"><table aria-label="Message flows"><thead><tr><th>Sender</th><th>Recipient</th><th>Room</th><th>Type</th><th>Observed</th><th>Delivered</th><th>Content</th></tr></thead><tbody>{data.flows.map(flow => <tr key={JSON.stringify([flow.agentId, flow.senderBackendUserId, flow.roomId, flow.messageType])}><td>{flow.senderName ?? flow.senderBackendUserId}<span className="subline">{flow.senderBackendUserId}</span></td><td><a href={'/manage/agents/' + flow.agentId}>{data.agents.find(agent => agent.agentId === flow.agentId)?.displayName ?? flow.agentId}</a></td><td><code>{flow.roomId}</code></td><td>{flow.messageType}</td><td>{flow.totals.observed.toLocaleString()}</td><td>{flow.totals.delivered.toLocaleString()}</td><td>{bytes(flow.totals.contentBytes)}</td></tr>)}</tbody></table></div> : <Empty title="No traffic summaries yet">Traffic appears after a listener reports its next interval.</Empty>}<Pagination meta={data.meta}/></Panel>
      <Panel title="Native usage" description="Only measurements reported by the runtime adapter; no estimated billing."><dl><dt>Input</dt><dd>{data.tokens?.input.toLocaleString() ?? 'Not reported'}</dd><dt>Cached input</dt><dd>{data.tokens?.cachedInput.toLocaleString() ?? 'Not reported'}</dd><dt>Cache-write input</dt><dd>{data.tokens?.cacheWriteInput?.toLocaleString() ?? 'Not reported'}</dd><dt>Output</dt><dd>{data.tokens?.output.toLocaleString() ?? 'Not reported'}</dd><dt>Reasoning output</dt><dd>{data.tokens?.reasoningOutput?.toLocaleString() ?? 'Not reported'}</dd><dt>Total tokens</dt><dd>{data.tokens?.total.toLocaleString() ?? 'Not reported'}</dd><dt>Provider spend</dt><dd>{data.spend ?? 'Not reported by this runtime'}</dd></dl><p className="support">Cached input and reasoning output are subsets, not additional tokens. Collection begins with a native counter baseline; earlier session use is not attributed to this period. Unsupported measurements remain unknown.</p></Panel>
    </>}</Loaded></>;
}
