import { useCallback, useEffect, useState } from 'react';
import type { AgentView, FleetView } from '@ctlflow/crossfire-contracts/schema/response';
import type { InputOf, OutputOf } from '@ctlflow/crossfire-contracts/rest/operation';
import type { Response } from '@ctlflow/crossfire-contracts/rest/envelope';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Help, Loaded, Panel, Pagination, Status, timestamp } from './ui.js';
import { NativeRuntimeDetails } from './runtime-status.js';
import { canManageFleet } from './fleet-authority.js';
import { useConfirmation } from './confirmation.js';

export function FleetSessions({ fleet, agent, refresh }: { fleet: FleetView; agent?: AgentView; refresh(): void }) {
  const viewer = useSession(), action = useAction(), confirmation = useConfirmation();
  const [request, setRequest] = useState<InputOf<typeof operations.requestFleetRuntime>>(), [accepted, setAccepted] = useState('');
  const [pendingReceipt, setPendingReceipt] = useState<string>();
  const historyPage = new URLSearchParams(location.search).get('sessionsPage') ?? '1';
  const history = useResource(operations.fleetRuntimeOperations, { fleetId: fleet.fleetId }, 'page=1&pageSize=10', 3000);
  useEffect(() => {
    if (!pendingReceipt || history.result?.ok !== true) return;
    const operation = history.result.value.data.find(value => value.operationId === pendingReceipt);
    if (operation?.status !== 'succeeded' && operation?.status !== 'failed') return;
    setPendingReceipt(undefined); refresh();
  }, [pendingReceipt, history.result, refresh]);
  const busy = history.result?.ok === true && history.result.value.data.some(operation => operation.status === 'pending' || operation.status === 'running');
  const allowed = canManageFleet(fleet) && (!agent || agent.allowedActions.includes('configure'));
  const disabled = action.pending || history.result?.ok !== true || busy || !allowed || fleet.delivery.connection.status !== 'online';
  const subject = agent ? agent.displayName : 'all agents in ' + fleet.label;
  function submit(input: InputOf<typeof operations.requestFleetRuntime>) {
    setRequest(input); setAccepted('');
    return action.run(async () => {
      const result = await call(operations.requestFleetRuntime, { fleetId: fleet.fleetId }, input, viewer.csrfSecret);
      if (!result.ok && ['invalid', 'unauthorized', 'forbidden', 'missing', 'conflict', 'stale_revision', 'capacity'].includes(result.error.code)) {
        setRequest(undefined); history.refresh(); refresh();
      }
      return result;
    }, operation => {
      const query = new URLSearchParams(location.search); query.set('sessionsPage', '1');
      window.history.replaceState(null, '', location.pathname + '?' + query);
      setAccepted(operation.status === 'pending' || operation.status === 'running' ? 'Requested. The controller’s outcome appears below.' : 'This request has already completed. Its outcome appears below.');
      setPendingReceipt(operation.status === 'pending' || operation.status === 'running' ? operation.operationId : undefined);
      setRequest(undefined); history.refresh(); refresh();
    });
  }
  function operate(kind: 'start' | 'stop' | 'reset'): void {
    const input = request?.action === kind ? request : { operationId: crypto.randomUUID(), action: kind, agentId: agent?.agentId ?? null,
      expectedRevision: fleet.revision, confirmFreshHistory: kind === 'reset' };
    if (kind === 'start') { void submit(input); return; }
    confirmation.request({ title: kind === 'reset' ? 'Start with fresh history?' : 'Stop sessions?',
      description: kind === 'reset' ? 'Start ' + subject + ' with fresh history. This stops the current sessions and replaces their model contexts. Old histories are archived; Matrix messages, identity, room access and configured parameters are retained.'
        : 'Stop the sessions for ' + subject + '. Saved histories are retained. Running commands are not suspended for later continuation. The fleet controller stays connected.',
      label: kind === 'reset' ? 'Start with fresh history' : agent ? 'Stop session' : 'Stop sessions', danger: true, execute: () => submit(input) });
  }
  return <Panel title={agent ? 'Agent session' : 'Fleet sessions'} description={agent ? 'Stop or resume this agent through its controller.' : 'Stop or resume every agent in this fleet. The controller stays connected.'}>
    {agent && <NativeRuntimeDetails agent={agent}/>}
    <div className="actions"><button disabled={disabled} onClick={() => operate('start')}>{agent ? 'Resume session' : 'Resume sessions'}</button>
      <button disabled={disabled} onClick={() => operate('stop')}>{agent ? 'Stop session' : 'Stop sessions'}</button></div>
    <p className="support">Resume reopens the saved native histories with the same identity and configured parameters. If a saved history cannot be resumed, the operation fails instead of creating another one.</p>
    {agent && agent.activity.status !== 'online' && <p className="support">A confirmed stop is shown as Stopped. Other offline activity is historical, not a live native state. Resume availability depends on the saved history, not a heartbeat.</p>}
    <p className="support">Controller online and Delivery enabled do not mean sessions are running. Explicitly stopped agents cannot receive work until resumed.</p>
    {busy && <p className="support" role="status">A session operation is awaiting the controller’s completion. Controls become available when its outcome is acknowledged.</p>}
    {fleet.delivery.connection.status !== 'online' && <p className="support plan-warning">The fleet controller must reconnect before session controls are available.</p>}
    <Alert>{action.error}</Alert><p role="status">{accepted}</p>{confirmation.dialog}
    <details className="session-fresh"><summary>Start over with fresh history</summary>
      <p>The controller stops {agent ? 'this agent' : 'all agents'}, archives the old history bindings and starts fresh contexts. This retains chats, identities, permissions and configured parameters.</p>
      <div className="actions"><button className="danger" disabled={disabled} onClick={() => operate('reset')}>Start with fresh history</button><span className="support">Confirmation required</span></div>
    </details>
    <details className="session-operations" open={busy || accepted !== '' || history.result?.ok === false}><summary>Session operations</summary><p className="support">Controller-reported outcomes, not model-task completion.</p>
    {historyPage === '1' ? <SessionHistory history={history} agent={agent}/> : <PagedSessionHistory fleetId={fleet.fleetId} page={historyPage} agent={agent}/>}
    </details><Help title="Sessions, sleep and delivery"><p>The fleet controller receives messages for its agent bindings. Stopping sessions ends the native engines and prevents messages from starting them again until you resume. The controller stays connected.</p>
      <p>Automatic sleep is different: the listener stays ready and an eligible message resumes the saved history. Pausing delivery prevents new input without replacing that history. Resume follows the fleet’s existing delivery setting.</p>
      <p>Shared or per-room native history follows each agent’s fleet configuration. A reporting listener does not mean its native engine is running.</p></Help>
  </Panel>;
}
type History = { result: Result<Response<OutputOf<typeof operations.fleetRuntimeOperations>>> | undefined; refresh(): void };
function PagedSessionHistory({ fleetId, page, agent }: { fleetId: string; page: string; agent: AgentView | undefined }) {
  const query = new URLSearchParams({ page, pageSize: '10' });
  const history = useResource(operations.fleetRuntimeOperations, { fleetId }, query.toString(), 3000);
  return <SessionHistory history={history} agent={agent}/>;
}
function SessionHistory({ history, agent }: { history: History; agent: AgentView | undefined }) {
  return <Loaded {...history} retry={history.refresh}>{page => <>{page.data.length ? <div className="table-wrap"><table aria-label="Session operations"><thead><tr><th>Action</th><th>Scope</th><th>Status</th><th>Requested</th><th>Outcome</th></tr></thead><tbody>{page.data.map(operation =>
    <tr key={operation.operationId}><td>{operation.action === 'reset' ? 'Fresh history' : operation.action === 'start' ? 'Resume' : 'Stop'}</td><td>{operation.agentId ? <a href={'/manage/agents/' + operation.agentId + '/session'}>{agent?.agentId === operation.agentId ? agent.displayName : 'One agent'}</a> : 'Entire fleet'}</td><td><Status value={operation.status}/></td><td>{timestamp(operation.createdAt)}</td><td>{operation.errorMessage ?? (operation.completedAt === null ? 'Awaiting controller completion' : 'Completed ' + timestamp(operation.completedAt))}</td></tr>)}</tbody></table></div>
    : <Empty title="No session operations">Stops, resumes and fresh-history requests from management appear here.</Empty>}<Pagination meta={page.meta} parameter="sessionsPage"/></>}</Loaded>;
}
export function AgentSessions({ agent, refresh }: { agent: AgentView; refresh(): void }) {
  const resource = useResource(operations.fleet, { fleetId: agent.deployment.fleetId }, '', 5000);
  const refreshStatus = useCallback(() => { resource.refresh(); refresh(); }, [resource.refresh, refresh]);
  return <Loaded {...resource} retry={resource.refresh}>{({ data: fleet }) => <FleetSessions fleet={fleet} agent={agent} refresh={refreshStatus}/>}</Loaded>;
}
