import { useEffect, useMemo, useState } from 'react';
import type { FleetMapView } from '@crossfire/contracts/schema/fleet-map';
import { operations, useResource } from '../api.js';
import { Empty, Field, Loaded, Page, Status, timestamp } from '../ui.js';
import { FleetNavigation } from '../fleet-navigation.js';
import { FleetGraph } from './graph.js';
import { FleetMapDetails } from './details.js';
import { filterMap, readSelection, selectionKey, type MapFilters, type MapSelection } from './model.js';

function readState() {
  const query = new URLSearchParams(location.search), listener = query.get('listener');
  return { selection: readSelection(query.get('node')), filters: { search: (query.get('search') ?? '').slice(0, 255),
    listener: listener === 'online' || listener === 'offline' || listener === 'disconnecting' ? listener : 'all' } as MapFilters };
}
function MapView({ map }: { map: FleetMapView }) {
  const [state, setState] = useState(readState), [search, setSearch] = useState(state.filters.search);
  useEffect(() => {
    const pop = () => { const next = readState(); setState(next); setSearch(next.filters.search); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, []);
  function navigate(filters: MapFilters, selection: MapSelection | null) {
    const subset = filterMap(map, filters);
    const current = selection && (selection.kind === 'agent' ? subset.agents.some(agent => agent.agentId === selection.id)
      : selection.kind === 'room' ? subset.rooms.some(room => room.roomId === selection.id) : subset.sources.some(source => source.sourceId === selection.id)) ? selection : null;
    const url = new URL(location.href);
    for (const key of ['node', 'search', 'listener', 'connectionsPage', 'authorsPage', 'sourceAgentsPage']) url.searchParams.delete(key);
    if (filters.search) url.searchParams.set('search', filters.search);
    if (filters.listener !== 'all') url.searchParams.set('listener', filters.listener);
    if (current) url.searchParams.set('node', selectionKey(current));
    history.pushState(null, '', url); setState({ filters, selection: current });
  }
  const visible = useMemo(() => filterMap(map, state.filters), [map, state.filters]);
  return <div className="fleet-map-view"><div className="map-summary"><div><strong>{map.fleet.label}</strong><span>{map.agents.length} agents · {map.rooms.length} rooms</span></div>
    <div><span>Controller {map.fleet.controller.name}</span><Status value={map.fleet.delivery.connection.status}/><span>Delivery {map.fleet.delivery.deliveryEnabled ? 'enabled' : 'paused'}</span></div></div>
    <form className="filter-bar map-filters" onSubmit={event => { event.preventDefault(); navigate({ ...state.filters, search: search.trim() }, state.selection); }}>
      <label>Search map<input type="search" maxLength={255} placeholder="Agent, room or wake-up rule" value={search} onChange={event => setSearch(event.target.value)}/></label>
      <Field label="Listener status">{id => <select id={id} value={state.filters.listener} onChange={event => {
        const listener = event.target.value;
        if (listener === 'all' || listener === 'online' || listener === 'offline' || listener === 'disconnecting') navigate({ ...state.filters, listener }, state.selection);
      }}><option value="all">All listeners</option><option value="online">Online</option><option value="offline">Offline</option><option value="disconnecting">Disconnecting</option></select>}</Field>
      <div className="filter-actions"><button>Apply search</button><button type="button" onClick={() => { setSearch(''); navigate({ search: '', listener: 'all' }, state.selection); }}>Reset filters</button></div>
    </form>
    <div className="map-toolbar"><p role="status">{visible.agents.length} of {map.agents.length} agents shown · {visible.rooms.length} connected rooms</p>
      {state.selection && <a href="#fleet-map-details">View selected details ↓</a>}</div>
    <div className="map-legend" aria-label="Connection legend"><span><i className="map-key map-key-wake"/>Wake rule</span><span><i className="map-key map-key-read"/>Read only</span>
      <span><i className="map-key map-key-reply"/>Read &amp; reply</span><span><i className="map-key map-key-custom"/>Custom level</span>
      <span><i className="map-key map-key-pending"/>Dashed: muted, pending, not joined or removing</span><span><i className="map-key map-key-failed"/>Failed</span></div>
    {visible.agents.length ? <FleetGraph map={visible} selection={state.selection} onSelect={selection => navigate(state.filters, selection)}/>
      : <Empty title={map.agents.length ? 'No matching agents' : 'No agents in this fleet'}>{map.agents.length ? 'Reset the filters to see the complete fleet.' : 'The controller has no enrolled instances in this group.'}</Empty>}
    <p className="support map-footnote">Captured {timestamp(map.capturedAt)} · Refreshes every 30 seconds. Lines show assigned access and last observed enforcement, not live model work. Online means a listener is reporting.</p>
    <div id="fleet-map-details"><FleetMapDetails key={state.selection ? selectionKey(state.selection) : 'none'} map={map} selection={state.selection} onClear={() => navigate(state.filters, null)}/></div>
  </div>;
}
export function FleetMap({ id }: { id: string }) {
  const resource = useResource(operations.fleetMap, { fleetId: id }, '', 30000);
  return <Page title="Fleet map" description="Wake-up sources, agents and room access." action={<button onClick={resource.refresh}>Refresh map</button>}><a className="back" href="/manage/fleets">← Fleets</a>
    <FleetNavigation id={id} map/><Loaded {...resource} retry={resource.refresh}>{result => <MapView map={result.data}/>}</Loaded></Page>;
}
