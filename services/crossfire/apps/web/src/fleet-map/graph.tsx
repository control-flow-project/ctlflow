import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FleetMapView } from '@ctlflow/crossfire-contracts/schema/fleet-map';
import { adjacentNode, layoutFleetMap, type MapNode } from './layout.js';
import { connectionState, highlightedMap, selectionKey, sourceLabel, sourceTitle, type MapSelection } from './model.js';

function countLabel(count: number, noun: 'agent' | 'room'): string { return count + ' ' + noun + (count === 1 ? '' : 's'); }

export function FleetGraph({ map, selection, onSelect }: { map: FleetMapView; selection: MapSelection | null; onSelect: (value: MapSelection | null) => void }) {
  const container = useRef<HTMLDivElement>(null), buttons = useRef(new Map<string, HTMLButtonElement>());
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = container.current; if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(() => layoutFleetMap(map, width), [map, width]);
  const highlighted = useMemo(() => highlightedMap(map, selection), [map, selection]);
  const selected = selection ? selectionKey(selection) : '';
  const agents = new Map(map.agents.map(agent => [agent.agentId, agent])), rooms = new Map(map.rooms.map(room => [room.roomId, room]));
  const sources = new Map(map.sources.map(source => [source.sourceId, source]));
  const roomCounts = new Map<string, number>(), agentCounts = new Map<string, number>(), sourceCounts = new Map<string, number>();
  for (const connection of map.connections) {
    roomCounts.set(connection.roomId, (roomCounts.get(connection.roomId) ?? 0) + 1);
    agentCounts.set(connection.agentId, (agentCounts.get(connection.agentId) ?? 0) + 1);
  }
  for (const agent of map.agents) sourceCounts.set(agent.sourceId, (sourceCounts.get(agent.sourceId) ?? 0) + 1);
  function contents(node: MapNode) {
    if (node.kind === 'agent') {
      const agent = agents.get(node.id)!;
      const count = agentCounts.get(node.id) ?? 0;
      return { title: agent.displayName, caption: agent.listener + ' · ' + countLabel(count, 'room'), status: agent.listener,
        warning: agent.status !== 'active' ? agent.status : agent.owner.status !== 'active' ? 'Owner ' + agent.owner.status : '' };
    }
    if (node.kind === 'room') {
      const room = rooms.get(node.id)!;
      return { title: room.name ?? 'Name unavailable', caption: countLabel(roomCounts.get(node.id) ?? 0, 'agent'), status: '', warning: '' };
    }
    const source = sources.get(node.id)!;
    return { title: sourceTitle(map, source), caption: countLabel(sourceCounts.get(node.id) ?? 0, 'agent') + (source.mode === 'selected' ? ' · ' + source.selectedPrincipalIds.length + ' chosen' : ''), status: '', warning: '' };
  }
  return <div ref={container} className="fleet-map-viewport" tabIndex={0} aria-label="Scrollable fleet connection map">
    <div className={'fleet-map-canvas' + (selected ? ' has-selection' : '')} role="group" aria-label="Fleet connection graph" style={{ width: layout.width, height: layout.height }}>
      <svg width={layout.width} height={layout.height} aria-hidden="true" className="fleet-map-lines">
        {layout.edges.map(edge => {
          const state = edge.connection ? connectionState(edge.connection) : null;
          return <path key={edge.key} d={edge.path} className={'map-edge map-edge-' + (state?.status === 'failed' ? 'failed' : state?.access ?? 'wake')}
            data-highlighted={highlighted.connections.has(edge.key)} data-dashed={state?.muted || state?.status === 'pending' || state?.removing || state?.notJoined || undefined}/>;
        })}
      </svg>
      {layout.headings.map(heading => <span className="fleet-map-column" key={heading.label} style={{ left: heading.x, width: heading.width }}>{heading.label}</span>)}
      {layout.nodes.map(node => {
        const content = contents(node);
        return <button type="button" key={node.key} ref={element => { if (element) buttons.current.set(node.key, element); else buttons.current.delete(node.key); }}
          className={'map-node map-node-' + node.kind} data-node={node.key} data-highlighted={highlighted.nodes.has(node.key)} aria-pressed={selected === node.key}
          aria-controls="fleet-map-details"
          aria-label={'Select ' + node.kind + ' ' + (node.kind === 'source' ? sourceLabel(sources.get(node.id)!) : content.title)}
          title={content.title + '\n' + content.caption + (node.kind === 'source' ? '\n' + sourceLabel(sources.get(node.id)!) : '') + (content.warning ? '\n' + content.warning : '')}
          style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
          onClick={() => onSelect({ kind: node.kind, id: node.id })} onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); onSelect(null); return; }
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? layout.nodes[0] : event.key === 'End' ? layout.nodes[layout.nodes.length - 1] : adjacentNode(layout.nodes, node, event.key);
            if (next) buttons.current.get(next.key)?.focus();
          }}>
          <strong>{node.kind === 'agent' && <span aria-hidden="true" className={'map-dot map-dot-' + content.status}/>}<span>{content.title}</span>
            {content.warning && <span className="map-node-warning" aria-label={content.warning}>!</span>}</strong><small>{content.caption}</small>
        </button>;
      })}
    </div>
  </div>;
}
