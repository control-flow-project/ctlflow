import type { FleetMapView, MapConnection, MapSource } from '@ctlflow/crossfire-contracts/schema/fleet-map';
import { WAKE_LABELS } from '@ctlflow/crossfire-contracts/wake';

export type MapSelection = { kind: 'agent' | 'room' | 'source'; id: string };
export type MapFilters = { search: string; listener: 'all' | 'online' | 'offline' | 'disconnecting' };
export function selectionKey(selection: MapSelection): string { return selection.kind + ':' + selection.id; }
export function readSelection(value: string | null): MapSelection | null {
  if (!value) return null;
  const separator = value.indexOf(':'), kind = value.slice(0, separator), id = value.slice(separator + 1);
  return (kind === 'agent' || kind === 'room' || kind === 'source') && id ? { kind, id } : null;
}
export function sourceLabel(source: MapSource): string { return WAKE_LABELS[source.mode]; }
export function sourceTitle(map: FleetMapView, source: MapSource): string {
  if (source.mode === 'humans') return 'All people + selected agents';
  if (source.mode === 'everyone') return 'Everyone';
  const selected = new Map(source.senders.map(sender => [sender.principalId, sender.includeAgents]));
  const names = map.principals.filter(principal => selected.has(principal.principalId))
    .map(principal => principal.displayName + (selected.get(principal.principalId) ? ' + agents' : '')).sort();
  return names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) : '') : 'No selected authors';
}
export function connectionState(connection: MapConnection) {
  const { grant, application } = connection;
  const removing = grant === null || grant.accessMode === 'none';
  const applied = grant !== null && application?.observedGeneration === grant.generation
    && application.appliedRevision === grant.revision && application.appliedAccessRevision === grant.accessRevision;
  const status = application?.errorCode || application?.errorMessage ? 'failed' : applied ? 'applied' : 'pending';
  return { status, access: grant?.accessMode ?? 'none', muted: grant?.muted ?? false, removing, notJoined: application?.membership !== 'join' } as const;
}
export function accessLabel(connection: MapConnection): string {
  switch (connection.grant?.accessMode ?? 'none') {
    case 'none': return 'No access';
    case 'read': return 'Read only';
    case 'reply': return 'Read & reply';
    case 'custom': return 'Level ' + connection.grant!.powerLevel;
  }
}
export function filterMap(map: FleetMapView, filters: MapFilters): FleetMapView {
  const search = filters.search.trim().toLocaleLowerCase();
  const roomNames = new Map(map.rooms.map(room => [room.roomId, [room.name, room.alias, room.roomId].join(' ').toLocaleLowerCase()]));
  const sourceNames = new Map(map.sources.map(source => [source.sourceId, sourceLabel(source).toLocaleLowerCase()]));
  const roomSearchByAgent = new Map<string, string[]>();
  for (const connection of map.connections) {
    const names = roomSearchByAgent.get(connection.agentId) ?? []; names.push(roomNames.get(connection.roomId) ?? ''); roomSearchByAgent.set(connection.agentId, names);
  }
  const agents = map.agents.filter(agent => (filters.listener === 'all' || agent.listener === filters.listener)
    && (!search || [agent.displayName, agent.instanceKey, agent.matrixUserId, sourceNames.get(agent.sourceId), ...(roomSearchByAgent.get(agent.agentId) ?? [])]
      .join(' ').toLocaleLowerCase().includes(search)));
  const agentIds = new Set(agents.map(agent => agent.agentId)), sourceIds = new Set(agents.map(agent => agent.sourceId));
  const connections = map.connections.filter(connection => agentIds.has(connection.agentId)), roomIds = new Set(connections.map(connection => connection.roomId));
  return { ...map, agents, connections, sources: map.sources.filter(source => sourceIds.has(source.sourceId)), rooms: map.rooms.filter(room => roomIds.has(room.roomId)) };
}
export function highlightedMap(map: FleetMapView, selection: MapSelection | null): { nodes: Set<string>; connections: Set<string> } {
  const agentIds = new Set<string>();
  if (selection?.kind === 'agent') agentIds.add(selection.id);
  if (selection?.kind === 'source') for (const agent of map.agents) if (agent.sourceId === selection.id) agentIds.add(agent.agentId);
  if (selection?.kind === 'room') for (const connection of map.connections) if (connection.roomId === selection.id) agentIds.add(connection.agentId);
  const nodes = new Set<string>(), connections = new Set<string>();
  if (selection) nodes.add(selectionKey(selection));
  for (const agent of map.agents) if (agentIds.has(agent.agentId)) {
    nodes.add('agent:' + agent.agentId); nodes.add('source:' + agent.sourceId);
    connections.add('wake:' + agent.agentId);
  }
  for (const connection of map.connections) if (agentIds.has(connection.agentId) && (selection?.kind !== 'room' || connection.roomId === selection.id)) {
    nodes.add('room:' + connection.roomId); connections.add('room:' + connection.agentId + ':' + connection.roomId);
  }
  return { nodes, connections };
}
