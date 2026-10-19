import type { FleetMapView, MapAgent, MapConnection, MapSource } from '@ctlflow/crossfire-contracts/schema/fleet-map';
import { Empty, PageItems, Status, timestamp } from '../ui.js';
import { accessLabel, connectionState, sourceLabel, type MapSelection } from './model.js';

function Connections({ map, connections, agent }: { map: FleetMapView; connections: MapConnection[]; agent?: MapAgent }) {
  const rooms = new Map(map.rooms.map(room => [room.roomId, room])), agents = new Map(map.agents.map(entry => [entry.agentId, entry]));
  return <PageItems items={connections} parameter="connectionsPage">{items => items.length ? <div className="table-wrap"><table aria-label="Selected room connections">
    <thead><tr><th>{agent ? 'Room' : 'Agent'}</th><th>Assigned access</th><th>Last observed</th><th>Delivery</th></tr></thead><tbody>{items.map(connection => {
      const state = connectionState(connection), room = rooms.get(connection.roomId)!, receiver = agents.get(connection.agentId)!;
      return <tr key={connection.agentId + ':' + connection.roomId}><td><strong><a href={agent
        ? '/manage/agents/' + agent.agentId + '/rooms/' + encodeURIComponent(room.roomId) : '/manage/agents/' + receiver.agentId}>
        {agent ? room.name ?? 'Name unavailable' : receiver.displayName}</a></strong><span className="subline">{agent ? room.alias ?? room.roomId : receiver.instanceKey}</span></td>
        <td>{accessLabel(connection)}<span className="subline"><Status value={state.status}/>{state.removing && ' · removal'}</span>
          {connection.application?.errorMessage && <span className="subline map-error">{connection.application.errorMessage}</span>}</td>
        <td>{connection.application?.membership ?? 'Not observed'}{connection.application?.nativeAccess
          && <span className="subline mono">{JSON.stringify(connection.application.nativeAccess)}</span>}<span className="subline">{timestamp(connection.application?.lastSuccessAt ?? null)}</span></td>
        <td>{receiver.status !== 'active' || receiver.owner.status !== 'active' ? 'Account inactive' : state.removing ? 'No assigned delivery'
          : state.muted ? 'Muted' : state.notJoined ? 'Not joined' : 'Unmuted'}<span className="subline">{receiver.listener} listener</span></td></tr>;
    })}</tbody></table></div> : <Empty title="No rooms">This agent has no assigned or unresolved room connections.</Empty>}</PageItems>;
}

function Identities({ map, source, agent }: { map: FleetMapView; source: MapSource; agent?: MapAgent }) {
  const enabled = !agent || agent.status === 'active' && agent.owner.status === 'active';
  const eligible = new Set(enabled ? source.eligiblePrincipalIds.filter(id => id !== agent?.agentId) : []);
  const configured = new Map(source.senders.map(sender => [sender.principalId, sender.includeAgents]));
  const identities = map.principals.filter(identity => eligible.has(identity.principalId) || configured.has(identity.principalId))
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.backendUserId.localeCompare(right.backendUserId));
  return <><p className="support">{eligible.size} active identities allowed by this rule.{!agent && ' Each agent excludes itself.'} Room access and unmuted delivery are still required.</p>
    {!enabled && <p className="support">Chat delivery is disabled while the agent or owner account is inactive.</p>}
    <PageItems items={identities} parameter="authorsPage">{items => items.length ? <div className="table-wrap"><table aria-label="Wake-up identities">
      <thead><tr><th>Identity</th><th>Type</th><th>Wake eligibility</th></tr></thead><tbody>{items.map(identity => <tr key={identity.principalId}>
        <td><strong>{identity.displayName}</strong><span className="subline mono">{identity.backendUserId}</span></td><td>{identity.kind}</td>
        <td>{eligible.has(identity.principalId) ? 'Allowed' : 'Selected, not eligible'}{configured.get(identity.principalId) && <span className="subline">Includes their agents</span>}</td></tr>)}</tbody></table></div>
      : <p className="support">Nobody can trigger chat input under this rule{!enabled ? ' while the account is inactive' : ''}. Scheduled Wake-ups and terminal input remain separate.</p>}</PageItems></>;
}

export function FleetMapDetails({ map, selection, onClear }: { map: FleetMapView; selection: MapSelection | null; onClear: () => void }) {
  const heading = (title: string, action?: { href: string; label: string }) => <header className="panel-heading"><div><h2>{title}</h2></div>
    <div className="map-detail-actions">{action && <a href={action.href}>{action.label} →</a>}<button onClick={onClear}>Clear selection</button></div></header>;
  if (!selection) return <section className="map-inspector" aria-label="Connection details"><h2>Connection details</h2>
    <p className="support">Select an agent, room or wake source to highlight its connections. Use arrow keys to move between nodes; Enter selects and Escape clears.</p></section>;
  if (selection.kind === 'agent') {
    const agent = map.agents.find(entry => entry.agentId === selection.id), source = map.sources.find(entry => entry.sourceId === agent?.sourceId);
    if (!agent || !source) return <section className="map-inspector" aria-label="Connection details">{heading('Agent no longer in this fleet')}<p>Choose another node to inspect the current map.</p></section>;
    return <section className="map-inspector" aria-label="Connection details">{heading(agent.displayName, { href: '/manage/agents/' + agent.agentId, label: 'Agent details' })}
      <dl className="map-facts"><dt>Owner</dt><dd>{agent.owner.displayName} · {agent.owner.backendUserId}</dd><dt>Account</dt><dd><Status value={agent.status}/></dd>
        <dt>Listener</dt><dd><Status value={agent.listener}/> · Last heartbeat {agent.lastSeenAt === null ? 'Not reported' : timestamp(agent.lastSeenAt)}</dd><dt>Wake-up rule</dt><dd>{sourceLabel(source)}</dd></dl>
      <h3>Room connections</h3><Connections map={map} agent={agent} connections={map.connections.filter(connection => connection.agentId === agent.agentId)}/>
      <h3>Who can wake this agent</h3><Identities map={map} source={source} agent={agent}/></section>;
  }
  if (selection.kind === 'room') {
    const room = map.rooms.find(entry => entry.roomId === selection.id);
    if (!room) return <section className="map-inspector" aria-label="Connection details">{heading('Room no longer connected')}<p>Choose another node to inspect the current map.</p></section>;
    return <section className="map-inspector" aria-label="Connection details">{heading(room.name ?? 'Name unavailable')}
      <p className="mono">{room.alias ?? room.roomId}</p>{!room.name && <p className="support">The room name could not be read from the messaging backend. Access state remains visible.</p>}
      <Connections map={map} connections={map.connections.filter(connection => connection.roomId === room.roomId)}/></section>;
  }
  const source = map.sources.find(entry => entry.sourceId === selection.id);
  if (!source) return <section className="map-inspector" aria-label="Connection details">{heading('Wake source no longer configured')}<p>Choose another node to inspect the current map.</p></section>;
  const agents = map.agents.filter(agent => agent.sourceId === source.sourceId);
  return <section className="map-inspector" aria-label="Connection details">{heading(sourceLabel(source))}
    <p className="support">These agents share the same configured wake-up rule. Membership does not itself trigger delivery.</p>
    <h3>Agents using this rule</h3><PageItems items={agents} parameter="sourceAgentsPage">{items => <div className="table-wrap"><table aria-label="Agents using wake-up rule">
      <thead><tr><th>Agent</th><th>Listener</th><th>Account</th></tr></thead><tbody>{items.map(agent => <tr key={agent.agentId}>
        <td><a href={'/manage/agents/' + agent.agentId}>{agent.displayName}</a></td><td><Status value={agent.listener}/></td><td><Status value={agent.status}/></td></tr>)}</tbody></table></div>}</PageItems>
    <h3>Allowed authors across this group</h3><Identities map={map} source={source}/></section>;
}
