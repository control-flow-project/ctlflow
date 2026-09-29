import type { ActivityView } from '../../../packages/contracts/src/activity.js';
import { HEARTBEAT_MS } from '../../../packages/contracts/src/activity.js';
import { manifest } from '../../../packages/contracts/src/release.js';
import { useResource } from './api.js';
import { Loaded, Panel, Status, timestamp } from './ui.js';

export function ReleaseStatus({ installed, current }: { installed: string | null; current: string }) {
  return <Status value={installed === null ? 'Not reported' : installed === current ? 'Current' : 'Update available'}/>;
}

export function ListenerVersions({ activity }: { activity: ActivityView }) {
  const current = useResource('/_coord/release', manifest, HEARTBEAT_MS);
  return <Panel title="Listener software"><Loaded {...current} retry={current.refresh}>{release => <>
    <p>Current server release: <code className="release-id">{release.release}</code></p>
    {activity.runs.length ? <div className="table-wrap"><table><thead><tr><th>Listener run</th><th>Installed release</th><th>Version status</th><th>Started</th></tr></thead><tbody>{activity.runs.map(run => <tr key={run.id}>
      <td><code title={run.id}>{run.id.slice(0, 8)}</code>{run.disconnectRequested && <span className="subline">Disconnect requested</span>}</td>
      <td><code className="release-id">{run.release ?? 'Not reported'}</code></td><td><ReleaseStatus installed={run.release} current={release.release}/></td><td>{timestamp(run.started)}</td>
    </tr>)}</tbody></table></div> : <p>No reporting listeners. Last reported release: <code className="release-id">{activity.lastRelease ?? 'Not reported'}</code>.</p>}
    <p className="support">The release covers the client, skill and documentation. Reporting a version does not prove that the model read the skill. Updates never replace a running listener automatically.</p>
    <ul aria-label="Current release downloads"><li><a href={'/onboarding/' + release.release + '/README.md'}>Update instructions for this server</a></li><li><a href={'/onboarding/' + release.release + '/manifest.json'}>Current manifest and verification hashes</a></li></ul>
  </>}</Loaded></Panel>;
}
