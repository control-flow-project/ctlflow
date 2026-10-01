import type { FleetMapView, MapConnection } from '@crossfire/contracts/schema/fleet-map';
import type { MapSelection } from './model.js';
import { sourceLabel } from './model.js';

export type Point = { x: number; y: number };
export type MapNode = MapSelection & { key: string; x: number; y: number; width: number; height: number };
export type MapEdge = { key: string; from: string; to: string; points: Point[]; path: string; connection: MapConnection | null };
export type MapLayout = { width: number; height: number; columns: number; headings: { label: string; x: number; width: number }[]; nodes: MapNode[]; edges: MapEdge[] };

function roundedPath(points: Point[]): string {
  const unique = points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y);
  let path = 'M ' + unique[0]!.x + ' ' + unique[0]!.y;
  for (let index = 1; index < unique.length - 1; index++) {
    const previous = unique[index - 1]!, current = unique[index]!, next = unique[index + 1]!;
    const before = Math.hypot(current.x - previous.x, current.y - previous.y), after = Math.hypot(next.x - current.x, next.y - current.y);
    const radius = Math.min(6, before / 2, after / 2);
    const start = { x: current.x + (previous.x - current.x) * radius / before, y: current.y + (previous.y - current.y) * radius / before };
    const end = { x: current.x + (next.x - current.x) * radius / after, y: current.y + (next.y - current.y) * radius / after };
    path += ' L ' + start.x + ' ' + start.y + ' Q ' + current.x + ' ' + current.y + ' ' + end.x + ' ' + end.y;
  }
  const last = unique[unique.length - 1]!;
  return path + ' L ' + last.x + ' ' + last.y;
}

function sideNodes(kind: 'room' | 'source', items: { id: string; label: string; center: number }[], x: number, width: number, height: number): MapNode[] {
  const ordered = [...items].sort((left, right) => left.center - right.center || left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  const nodes: MapNode[] = [];
  for (const item of ordered) nodes.push({ kind, id: item.id, key: kind + ':' + item.id, x, width, height: 54,
    y: Math.max(46, item.center - 27, (nodes[nodes.length - 1]?.y ?? -30) + 76) });
  for (let index = nodes.length - 1; index >= 0; index--) nodes[index]!.y = Math.min(nodes[index]!.y, index === nodes.length - 1 ? height - 66 : nodes[index + 1]!.y - 76);
  return nodes;
}

export function layoutFleetMap(map: FleetMapView, availableWidth: number): MapLayout {
  const width = Math.max(700, Math.round(availableWidth)), sideWidth = Math.max(150, Math.min(208, Math.round(width * .14)));
  const left = 12 + sideWidth + 48, right = width - 12 - sideWidth - 48, middleWidth = right - left;
  const columns = Math.max(1, Math.min(map.agents.length || 1, Math.floor((middleWidth + 36) / 196)));
  const nodeWidth = (middleWidth - (columns - 1) * 36) / columns;
  const height = Math.max(360, 46 + Math.max(Math.ceil(map.agents.length / columns), map.sources.length, map.rooms.length) * 76 + 12);
  const sourcesById = new Map(map.sources.map(source => [source.sourceId, sourceLabel(source)]));
  const firstRoom = new Map<string, string>();
  const roomNames = new Map(map.rooms.map(room => [room.roomId, room.name ?? room.roomId]));
  for (const connection of map.connections) {
    const name = roomNames.get(connection.roomId)!;
    if (!firstRoom.has(connection.agentId) || name.localeCompare(firstRoom.get(connection.agentId)!) < 0) firstRoom.set(connection.agentId, name);
  }
  const orderedAgents = [...map.agents].sort((left, right) => sourcesById.get(left.sourceId)!.localeCompare(sourcesById.get(right.sourceId)!)
    || (firstRoom.get(left.agentId) ?? '\uffff').localeCompare(firstRoom.get(right.agentId) ?? '\uffff')
    || left.instanceKey.localeCompare(right.instanceKey) || left.agentId.localeCompare(right.agentId));
  const agents: MapNode[] = orderedAgents.map((agent, index) => ({ kind: 'agent', id: agent.agentId, key: 'agent:' + agent.agentId,
    x: left + (index % columns) * (nodeWidth + 36), y: 46 + Math.floor(index / columns) * 76, width: nodeWidth, height: 54 }));
  const byAgent = new Map(agents.map(node => [node.id, node]));
  const sourceCenters = new Map<string, number[]>(), roomCenters = new Map<string, number[]>();
  for (const agent of orderedAgents) {
    const centers = sourceCenters.get(agent.sourceId) ?? []; centers.push(byAgent.get(agent.agentId)!.y + 27); sourceCenters.set(agent.sourceId, centers);
  }
  for (const connection of map.connections) {
    const centers = roomCenters.get(connection.roomId) ?? []; centers.push(byAgent.get(connection.agentId)!.y + 27); roomCenters.set(connection.roomId, centers);
  }
  const center = (values: number[] | undefined) => values?.length ? values.reduce((total, value) => total + value, 0) / values.length : 73;
  const sources = sideNodes('source', map.sources.map(source => ({ id: source.sourceId, label: sourceLabel(source), center: center(sourceCenters.get(source.sourceId)) })), 12, sideWidth, height);
  const rooms = sideNodes('room', map.rooms.map(room => ({ id: room.roomId, label: room.name ?? room.roomId, center: center(roomCenters.get(room.roomId)) })), width - sideWidth - 12, sideWidth, height);
  const bySource = new Map(sources.map(node => [node.id, node])), byRoom = new Map(rooms.map(node => [node.id, node]));
  const edges: MapEdge[] = [];
  function edge(key: string, from: MapNode, to: MapNode, points: Point[], connection: MapConnection | null) {
    edges.push({ key, from: from.key, to: to.key, points, path: roundedPath(points), connection });
  }
  for (const agent of orderedAgents) {
    const source = bySource.get(agent.sourceId)!, node = byAgent.get(agent.agentId)!;
    edge('wake:' + agent.agentId, source, node, [{ x: source.x + source.width, y: source.y + 27 }, { x: left - 24, y: source.y + 27 },
      { x: left - 24, y: node.y - 10 }, { x: node.x - 12, y: node.y - 10 }, { x: node.x - 12, y: node.y + 27 }, { x: node.x, y: node.y + 27 }], null);
  }
  for (const connection of map.connections) {
    const node = byAgent.get(connection.agentId)!, room = byRoom.get(connection.roomId)!;
    edge('room:' + connection.agentId + ':' + connection.roomId, node, room, [{ x: node.x + node.width, y: node.y + 27 },
      { x: node.x + node.width + 12, y: node.y + 27 }, { x: node.x + node.width + 12, y: node.y + node.height + 10 },
      { x: right + 24, y: node.y + node.height + 10 }, { x: right + 24, y: room.y + 27 }, { x: room.x, y: room.y + 27 }], connection);
  }
  return { width, height, columns, headings: [{ label: 'Wake sources', x: 12, width: sideWidth }, { label: 'Agents', x: left, width: middleWidth },
    { label: 'Rooms', x: width - sideWidth - 12, width: sideWidth }], nodes: [...sources, ...agents, ...rooms], edges };
}

export function adjacentNode(nodes: MapNode[], current: MapNode, direction: string): MapNode | null {
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight', positive = direction === 'ArrowRight' || direction === 'ArrowDown';
  const axis = horizontal ? 'x' : 'y', other = horizontal ? 'y' : 'x';
  const candidates = nodes.filter(node => node.key !== current.key && (positive ? node[axis] > current[axis] + 1 : node[axis] < current[axis] - 1));
  const distance = (node: MapNode) => Math.abs(node[axis] - current[axis]) + Math.abs(node[other] - current[other]) * 3;
  candidates.sort((left, right) => distance(left) - distance(right) || left.key.localeCompare(right.key));
  return candidates[0] ?? null;
}
