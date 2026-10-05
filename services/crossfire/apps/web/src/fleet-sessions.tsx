import { useState } from 'react';
import type { AgentView, FleetView } from '@ctlflow/crossfire-contracts/schema/response';
import type { InputOf } from '@ctlflow/crossfire-contracts/rest/operation';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Help, Loaded, Panel, Pagination, Status, timestamp } from './ui.js';
import { NativeRuntimeDetails } from './runtime-status.js';

export function FleetSessions({ fleet, agent, refresh }: { fleet: FleetView; agent?: AgentView; refresh(): void }) {
  const viewer = useSession(), action = useAction();
  const [request, setRequest] = useState<InputOf<typeof operations.requestFleetRuntime>>(), [accepted, setAccepted] = useState('');
  const query = new URLSearchParams({ page: new URLSearchParams(location.search).get('sessionsPage') ?? '1', pageSize: '10' });
  const history = useResource(operations.fleetRuntimeOperations, { fleetId: fleet.fleetId }, query.toString(), 3000);
  const busy = history.result?.ok === true && history.result.value.data.some(operation => operation.status === 'pending' || operation.status === 'running');
  const allowed = viewer.permissions.includes('agent.configure.any') || fleet.owner.matrixUserId === viewer.member.matrixUserId && viewer.permissions.includes('agent.configure.owned');
  const disabled = action.pending || busy || !allowed || fleet.delivery.connection.status !== 'online';
  const subject = agent ? agent.displayName : 'all agents in ' + fleet.label;
  function operate(kind: 'start' | 'stop' | 'reset'): void {
    const prompt = kind === 'reset' ? 'Start ' + subject + ' with fresh history? This stops the current sessions and replaces their model contexts. Old histories are archived; Matrix messages, identity, room access and configured parameters are retained.'
      : kind === 'stop' ? 'Stop the sessions for ' + subject + '? Saved histories are retained. Running commands are not suspended for later continuation. The fleet controller stays connected.' : null;
    if (prompt && !confirm(prompt)) return;
    const input = request?.action === kind ? request : { operationId: crypto.randomUUID(), action: kind, agentId: agent?.agentId ?? null,
      expectedRevision: fleet.revision, confirmFreshHistory: kind === 'reset' };
    setRequest(input); setAccepted('');
    void action.run(async () => {
      const result = await call(operations.requestFleetRuntime, { fleetId: fleet.fleetId }, input, viewer.csrfSecret);
      if (!result.ok && ['invalid', 'unauthorized', 'forbidden', 'missing', 'conflict', 'stale_revision', 'capacity'].includes(result.error.code)) {
        setRequest(undefined); history.refresh(); refresh();
      }
      return result;
    }, operation => {
      setAccepted(operation.status === 'pending' || operation.status === 'running' ? 'Requested. The controller’s outcome appears below.' : 'This request has already completed. Its outcome appears below.');
      setRequest(undefined); history.refresh(); refresh();
    });
  }
  return <><Panel title={agent ? 'Agent session' : 'Fleet sessions'} description={agent ? 'Stop or resume this fleet-managed agent.' : 'Stop or resume every agent in this fleet. The controller stays connected.'}>
    {agent && <NativeRuntimeDetails agent={agent}/>}
    <div className="actions"><button disabled={disabled} onClick={() => operate('start')}>{agent ? 'Resume session' : 'Resume sessions'}</button>
      <button disabled={disabled} onClick={() => operate('stop')}>{agent ? 'Stop session' : 'Stop sessions'}</button></div>
    <p className="support">Resume reopens the saved native histories with the same identity and configured parameters. If a saved history cannot be resumed, the operation fails instead of creating another one.</p>
    {agent && agent.activity.status !== 'online' && <p className="support">Native activity is last reported while the listener is offline. Resume availability depends on the saved history, not a heartbeat.</p>}
    {fleet.delivery.connection.status !== 'online' && <p className="support plan-warning">The fleet controller must reconnect before session controls are available.</p>}
    <Alert>{action.error}</Alert><p role="status">{accepted}</p>
    <Help title="Sessions, sleep and delivery"><p>The fleet controller receives messages for its agent bindings. Stopping sessions ends the native engines and prevents messages from starting them again until you resume. The controller stays connected.</p>
      <p>Automatic sleep is different: the listener stays ready and an eligible message resumes the saved history. Pausing delivery prevents new input without replacing that history. Resume follows the fleet’s existing delivery setting.</p>
      <p>Shared or per-room native history follows each agent’s fleet configuration. A reporting listener does not mean its native engine is running.</p></Help>
  </Panel><Panel title="Fresh history" description="Replace model context only when you intend to start over.">
    <p>The controller stops {agent ? 'this agent' : 'all agents'}, archives the old history bindings and starts fresh contexts. Authorized Matrix history and configuration are made available for selective reading. This does not delete chats, identities or permissions.</p>
    <div className="actions"><button className="danger" disabled={disabled} onClick={() => operate('reset')}>Start with fresh history</button><span className="support">Confirmation required</span></div>
  </Panel><Panel title="Session operations" description="Controller-reported outcomes, not model-task completion.">
    <Loaded {...history} retry={history.refresh}>{page => <>{page.data.length ? <div className="table-wrap"><table aria-label="Session operations"><thead><tr><th>Action</th><th>Scope</th><th>Status</th><th>Requested</th><th>Outcome</th></tr></thead><tbody>{page.data.map(operation =>
      <tr key={operation.operationId}><td>{operation.action === 'reset' ? 'Fresh history' : operation.action === 'start' ? 'Resume' : 'Stop'}</td><td>{operation.agentId ? <a href={'/manage/agents/' + operation.agentId + '/sessions'}>{agent?.agentId === operation.agentId ? agent.displayName : 'Individual agent'}</a> : 'Entire fleet'}</td><td><Status value={operation.status}/></td><td>{timestamp(operation.createdAt)}</td><td>{operation.errorMessage ?? (operation.completedAt === null ? 'Awaiting controller completion' : 'Completed ' + timestamp(operation.completedAt))}</td></tr>)}</tbody></table></div>
      : <Empty title="No session operations">Stops, resumes and fresh-history requests from management appear here.</Empty>}<Pagination meta={page.meta} parameter="sessionsPage"/></>}</Loaded>
  </Panel></>;
}
export function AgentSessions({ agent }: { agent: AgentView }) {
  return agent.deployment ? <ManagedAgentSessions agent={agent} fleetId={agent.deployment.fleetId}/>
    : <Panel title="Session controls"><p>This is a direct agent connection. Crossfire does not own its process; stop or resume it in its native application.</p></Panel>;
}
function ManagedAgentSessions({ agent, fleetId }: { agent: AgentView; fleetId: string }) {
  const resource = useResource(operations.fleet, { fleetId }, '', 5000);
  return <Loaded {...resource} retry={resource.refresh}>{({ data: fleet }) => <FleetSessions fleet={fleet} agent={agent} refresh={resource.refresh}/>}</Loaded>;
}
