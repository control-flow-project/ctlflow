import { operations, useResource } from './api.js';
import { Empty, Help, Loaded, Panel, Pagination, Status, timestamp, pagingQuery } from './ui.js';
export function ListenerVersions({ agentId }: { agentId: string }) {
  const release = useResource(operations.release, {}, '', 30000), runs = useResource(operations.listenerRuns, { agentId }, pagingQuery('runsPage'), 30000);
  return <Panel title="Listener software" description="Compare installed releases and find update instructions."><Loaded {...release} retry={release.refresh}>{current => <>
    <p>Current server release: <code className="release-id">{current.data.release}</code></p>
    <Loaded {...runs} retry={runs.refresh}>{page => <>{page.data.length ? <div className="table-wrap"><table aria-label="Listener releases"><thead><tr><th>Listener run</th><th>Installed release</th><th>Version status</th><th>Started</th><th>Stopped</th></tr></thead>
      <tbody>{page.data.map(run => <tr key={run.runId}><td><code title={run.runId}>{run.runId.slice(0, 8)}</code></td><td><code className="release-id">{run.release ?? 'Not reported'}</code></td>
        <td><Status value={run.release === current.data.release ? 'Current' : run.release ? 'Update available' : 'Not reported'}/></td><td>{timestamp(run.startedAt)}</td><td>{run.stoppedAt === null ? '—' : timestamp(run.stoppedAt)}</td></tr>)}</tbody></table></div>
        : <Empty title="No listener history">Connect or reconnect this agent to report its installed software.</Empty>}<Pagination parameter="runsPage" meta={page.meta}/></>}</Loaded>
    <a href={'/onboarding/' + current.data.release + '/README.md'}>Update instructions for this server</a>
    <Help title="What does version reporting prove?"><p>The release covers the client, skill and documentation. Version reporting does not prove the model read a skill. Reconnect to update; a running listener is never silently replaced.</p></Help>
  </>}</Loaded></Panel>;
}
