import { operations, useResource } from './api.js';
import { Empty, Help, Loaded, Panel, PageItems, timestamp } from './ui.js';
import { NativeStatus, savedHistoryLabel } from './runtime-status.js';
import type { AgentView } from '@ctlflow/crossfire-contracts/schema/response';

export function Runtime({ agent }: { agent: AgentView }) {
  const observed = useResource(operations.runtimeObservations, { agentId: agent.agentId }, '', 10000);
  return <Panel title="Runtime settings" description="Model, effort and native parameters for each saved conversation.">
    <Loaded {...observed} retry={observed.refresh}>{response => response.data.length ? <>
      <PageItems items={response.data} parameter="contextsPage">{contexts => contexts.map(context => <details className="runtime-context" key={context.sessionId} open={response.data.length === 1}>
        <summary>{context.roomId ? 'Room history · ' + context.roomId : context.historyMode === 'shared' ? 'Shared history' : 'Private control history'} · <NativeStatus state={context.state}/></summary>
        <header className="panel-heading"><div><h3>{context.runtime}</h3><p>Observed {timestamp(context.observedAt)}</p></div>
          <NativeStatus state={context.state}/></header>
        <dl className="detail-list"><dt>Session</dt><dd><code>{context.sessionId}</code></dd><dt>History</dt><dd>{context.historyMode === 'shared' ? 'Shared across rooms' : 'Separate native histories per room'}</dd>
          <dt>Saved history</dt><dd>{savedHistoryLabel(context.historyAvailable)}</dd><dt>Last activity</dt><dd>{context.lastActivityAt === null ? 'Not reported' : timestamp(context.lastActivityAt)}</dd>
          <dt>Inline message limit</dt><dd>{context.maxInputBytes.toLocaleString()} UTF-8 bytes, including origin metadata; larger input uses private files</dd>
          <dt>Controller</dt><dd>{agent.deployment.controllerName}</dd><dt>Listener</dt><dd>{agent.activity.status === 'online' ? 'Reporting · native activity is separate' : agent.activity.status === 'disconnecting' ? 'Disconnecting' : 'Offline · native state is last reported'}</dd></dl>
        {agent.activity.status !== 'online' && <p className="support">The listener is not reporting. This native state is the last observation, not proof that the process is running.</p>}
        {context.errorMessage && <p role="alert" className="error">{context.errorMessage}</p>}
        <div className="table-wrap"><table aria-label="Runtime settings"><thead><tr><th>Setting</th><th>Configured</th><th>Effective</th></tr></thead>
          <tbody>{context.settings.map(setting => <tr key={setting.name}><td><code>{setting.name}</code></td><td>{setting.configured ?? 'Not explicitly configured'}</td><td>{setting.effective ?? 'Not reported by native runtime'}</td></tr>)}</tbody></table></div>
      </details>)}</PageItems>
      <Help title="Inspect the original session"><p>In the fleet CLI, run <code>fleet agent contexts FLEET AGENT</code> to list retained histories, then <code>fleet agent attach FLEET AGENT --context CONTEXT</code> for the exact native terminal command. Use the controller connection on the computer where this fleet runs.</p>
        <p>Listing histories does not wake an agent. A sleeping, stopped or failed runtime has no live terminal pointer. Resume the session first when you need to attach; the controller reopens the saved history, not a new one.</p>
        <p>The controller retries transient failures using the original history. Inspect its recorded error if recovery cannot proceed.</p>
        <p>Terminal-visible output is shared with the owner, including output derived from rooms the owner has not joined. Separate histories isolate conversation history, not files, tools or credentials.</p></Help>
    </> : <Empty title="No native observation yet">Start this agent through its controller to report native settings. An online heartbeat alone does not prove the model is working.</Empty>}</Loaded>
  </Panel>;
}
