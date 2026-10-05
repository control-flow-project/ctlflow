import type { AgentView, FleetView } from '@ctlflow/crossfire-contracts/schema/response';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Loaded, Panel } from './ui.js';
import { canManageFleet } from './fleet-authority.js';

export function FleetRetirement({ fleet }: { fleet: FleetView }) {
  const viewer = useSession(), action = useAction();
  if (!canManageFleet(fleet)) return null;
  const eligible = fleet.allowedActions.includes('archive');
  return <Panel title="Archive fleet" description="Retire its managed instances and revoke this controller’s authority. Identities, chats and saved histories are preserved.">
    <p>Archiving does not stop a local process. Stop every native session first and wait for the controller’s successful outcome. Crossfire enables archiving only after that evidence is recorded.</p>
    {!eligible && <p className="support plan-warning">This fleet is not ready to archive. <a href={'/manage/fleets/' + fleet.fleetId}>Review and stop sessions →</a></p>}
    <div className="actions"><button className="danger" disabled={!eligible || action.pending} onClick={() => {
      if (confirm('Archive ' + fleet.label + '? Its managed instances are retired and controller authority is revoked. Identities, chats and saved histories remain. This cannot be undone from management.')) {
        void action.run(() => call(operations.archiveFleet, { fleetId: fleet.fleetId }, { expectedRevision: fleet.revision }, viewer.csrfSecret), () => location.assign('/manage/fleets'));
      }
    }}>Archive fleet</button></div><Alert>{action.error}</Alert>
  </Panel>;
}
function RetireAgent({ agent }: { agent: AgentView }) {
  const viewer = useSession(), action = useAction();
  const fleet = useResource(operations.fleet, { fleetId: agent.deployment.fleetId }, '', 5000);
  const eligible = agent.allowedActions.includes('retire');
  return <Panel title="Retire agent" description="Disable this managed instance while preserving its identity, chats and saved history.">
    <p>Retirement does not stop a local process. Stop the native session first and wait for its successful controller outcome.</p>
    {!eligible && <p className="support plan-warning">This agent is not ready to retire. <a href={'/manage/agents/' + agent.agentId + '/session'}>Review and stop its session →</a></p>}
    <Loaded {...fleet} retry={fleet.refresh}>{({ data }) => <div className="actions"><button className="danger" disabled={!eligible || action.pending || !canManageFleet(data)} onClick={() => {
      if (confirm('Retire ' + agent.displayName + ' from ' + data.label + '? Its managed access is disabled. Identity, chats and saved history remain. This cannot be undone from management.')) {
        void action.run(() => call(operations.removeFleetAgent, { fleetId: data.fleetId, agentId: agent.agentId },
          { expectedRevision: data.revision, instanceKey: agent.deployment.instanceKey }, viewer.csrfSecret), () => location.assign('/manage/fleets/' + data.fleetId));
      }
    }}>Retire agent</button></div>}</Loaded><Alert>{action.error}</Alert>
  </Panel>;
}
export function AgentRetirement({ agent }: { agent: AgentView }) {
  return agent.allowedActions.includes('configure') ? <RetireAgent agent={agent}/> : null;
}
