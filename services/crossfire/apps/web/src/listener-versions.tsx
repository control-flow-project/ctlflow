import { useEffect, useState } from 'react';
import { operations, useResource } from './api.js';
import { Empty, Help, Loaded, Panel, Pagination, Status, timestamp, pagingQuery } from './ui.js';
import type { AgentView } from '@ctlflow/crossfire-contracts/schema/response';
function LastReportedSoftware({ agentId }: { agentId: string }) {
  const latest = useResource(operations.listenerRuns, { agentId }, 'page=1&pageSize=1', 30000);
  return <Loaded {...latest} retry={latest.refresh}>{response => response.data.length ? <>
    <p>Last reported installation. No listener is currently reporting.</p>
    <div className="table-wrap"><table aria-label="Last reported listener software"><thead><tr><th>Installed release</th><th>Last contact</th><th>Stopped</th></tr></thead>
      <tbody>{response.data.map(run => <tr key={run.runId}><td><code>{run.release}</code></td><td>{timestamp(run.lastSeenAt)}</td>
        <td>{run.stoppedAt === null ? 'Not reported' : timestamp(run.stoppedAt)}</td></tr>)}</tbody></table></div>
  </> : <p>No listener installation has been reported. Start this agent through its fleet controller to begin reporting.</p>}</Loaded>;
}
export function ListenerVersions({ agent }: { agent: AgentView }) {
  const agentId = agent.agentId;
  const release = useResource(operations.release, {}, '', 30000);
  const [history, setHistory] = useState(new URLSearchParams(location.search).has('runsPage'));
  const [checkedAt, setCheckedAt] = useState<number>();
  useEffect(() => { if (release.result?.ok) setCheckedAt(Date.now()); }, [release.result]);
  return <Panel title="Listener software" description="Compare installed releases and find update instructions."><Loaded {...release} retry={release.refresh}>{current => <>
    <dl className="detail-list"><dt>Latest server release</dt><dd><code className="release-id">{current.data.release}</code><span className="subline">Checked {timestamp(checkedAt ?? null)}</span></dd></dl>
    {agent.activity.activeRuns.length ? <div className="table-wrap"><table aria-label="Current listener software"><thead><tr><th>Installed release</th><th>Status</th><th>Last contact</th></tr></thead><tbody>{agent.activity.activeRuns.map(run => <tr key={run.runId}><td><code>{run.release}</code></td><td><Status value={run.release === current.data.release ? 'Current' : 'Update available'}/></td><td>{timestamp(run.lastSeenAt)}</td></tr>)}</tbody></table></div> : <LastReportedSoftware agentId={agentId}/>}
    <details className="session-disclosure" open={history} onToggle={event => setHistory(event.currentTarget.open)}><summary>Run history</summary>{history && <RunHistory agentId={agentId}/>}</details>
    <a href={'/onboarding/' + current.data.release + '/README.md'}>Update instructions for this server</a>
    <Help title="What does version reporting prove?"><p>The release covers the client, skill and documentation. Version reporting does not prove the model read a skill. Update through the fleet controller with consent; a running listener is never silently replaced.</p></Help>
  </>}</Loaded></Panel>;
}
function RunHistory({ agentId }: { agentId: string }) {
  const runs = useResource(operations.listenerRuns, { agentId }, pagingQuery('runsPage'), 30000);
  return <Loaded {...runs} retry={runs.refresh}>{page => <>{page.data.length ? <div className="table-wrap"><table aria-label="Listener releases"><thead><tr><th>Listener run</th><th>Installed release</th><th>Started</th><th>Stopped</th></tr></thead>
    <tbody>{page.data.map(run => <tr key={run.runId}><td><code title={run.runId}>{run.runId.slice(0, 8)}</code></td><td><code className="release-id">{run.release}</code></td>
      <td>{timestamp(run.startedAt)}</td><td>{run.stoppedAt === null ? '—' : timestamp(run.stoppedAt)}</td></tr>)}</tbody></table></div>
    : <Empty title="No listener history">Listener runs appear after the fleet controller starts this agent.</Empty>}<Pagination parameter="runsPage" meta={page.meta}/></>}</Loaded>;
}
