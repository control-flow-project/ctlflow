import { Fragment, useState } from 'react';
import type { FleetView } from '@crossfire/contracts/schema/response';
import type { Parsed } from '@crossfire/contracts/schema/validation';
import { preview } from '@crossfire/contracts/schema/plan';
import { parseRoomPlan } from '@crossfire/contracts/room-plan';
import { failure, success } from '@crossfire/kernel/result';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Field, Help, Loaded, Page, Panel, Pagination, PageItems, Status, SubjectHeading, timestamp, pagingQuery } from './ui.js';
import { OwnerFilter } from './agent-filters.js';
import { filterQuery } from './form.js';
import { FleetDelivery, FleetMessages } from './fleet-control.js';
import { FleetNavigation, type FleetSection } from './fleet-navigation.js';
import { useFleetDirectory } from './fleet-directory.js';
import { FleetStatistics } from './fleet-statistics.js';
import { FleetSessions } from './fleet-sessions.js';

export function Fleets() {
  const viewer = useSession(), resource = useFleetDirectory(location.search);
  return <Page title="Fleets" description="Open a fleet to review its agents or manage delivery." action={<><button onClick={resource.refresh}>Refresh</button><a className="button" href="/manage/connect/fleet">Connect a fleet ↗</a></>}>
    <form className="filter-bar" onSubmit={event => { event.preventDefault(); location.assign('/manage/fleets?' + filterQuery(event.currentTarget)); }}><label>Search fleets or controllers<input name="search" type="search" defaultValue={new URLSearchParams(location.search).get('search') ?? ''}/></label>
      {viewer.permissions.includes('agent.read.any') && <OwnerFilter/>}<div className="filter-actions"><button>Apply filters</button><a href="/manage/fleets">Reset</a></div></form>
    <Loaded {...resource} retry={resource.refresh}>{fleets => fleets.length ? <><p className="collection-count">{fleets.length} {fleets.length === 1 ? 'fleet' : 'fleets'}</p><div className="table-wrap"><table aria-label="Fleets"><thead><tr><th scope="col">Fleet</th><th scope="col">Owner</th><th scope="col">Controller</th><th scope="col">Connection</th><th scope="col">Delivery</th></tr></thead><tbody>{fleets.map(fleet =>
      <tr key={fleet.fleetId}><td><a className="record-link" href={'/manage/fleets/' + fleet.fleetId}>{fleet.label}</a><span className="subline">{fleet.fleetKey}</span></td><td>{fleet.owner.displayName}<span className="subline">{fleet.owner.matrixUserId}</span></td><td>{fleet.controller.name}</td><td><Status value={fleet.delivery.connection.status}/></td><td><Status value={fleet.delivery.deliveryEnabled ? 'Enabled' : 'Deactivated'}/></td></tr>)}</tbody></table></div></>
      : <Empty title="No fleets">Connect a fleet with its controller to see its agents here.</Empty>}</Loaded>
    <Help title="What can I manage here?"><p>Manage delivery, stop or resume sessions, or send a message to the fleet. Session controls also work through the fleet CLI; the controller’s connection status is separate from each agent’s listener status.</p></Help></Page>;
}
function RoomPlan({ fleet }: { fleet: FleetView }) {
  const viewer = useSession(), action = useAction(), [source, setSource] = useState(''), [review, setReview] = useState<{ source: string; value: Parsed<typeof preview> }>();
  async function inspect() {
    const parsed = parseRoomPlan(source, fleet);
    if (!parsed.ok) return parsed;
    const result = await call(operations.previewGrants, {}, { plan: parsed.value }, viewer.csrfSecret);
    return result.ok ? success({ source, value: result.value }) : result;
  }
  async function apply() {
    if (!review || review.source !== source) return failure('conflict', 'Preview this exact room plan first');
    const parsed = parseRoomPlan(source, fleet);
    return parsed.ok ? call(operations.applyGrants, {}, { plan: parsed.value, digest: review.value.digest, snapshots: review.value.snapshots }, viewer.csrfSecret) : parsed;
  }
  return <Panel title="Room plan" description="Preview access changes before applying them to this fleet.">
    <p className="support plan-warning">The plan replaces grants for its listed instances. Omitted grants for those instances are removed. Create rooms in Element first.</p>
    <Field label="Room plan TOML">{id => <textarea id={id} rows={10} value={source} onChange={event => { setSource(event.target.value); setReview(undefined); }} spellCheck={false}/>}</Field>
    <div className="actions"><button disabled={action.pending || !source} onClick={() => { void action.run(inspect, setReview); }}>Preview room access</button>
      <button disabled={action.pending || !review} onClick={() => { if (confirm('Apply this exact room-access diff? Removed grants will lose access.')) void action.run(apply); }}>Apply reviewed plan</button></div><Alert>{action.error}</Alert>
    {review && <PageItems items={review.value.changes} parameter="planPage">{changes => <div className="table-wrap"><table aria-label="Room plan changes"><thead><tr><th>Agent</th><th>Room</th><th>Current</th><th>Desired</th><th>Native authority</th><th>Change</th></tr></thead><tbody>{changes.map(change =>
      <tr key={change.agentId + change.roomId}><td><a href={'/manage/agents/' + change.agentId}>{change.agentName}</a><span className="subline">{change.instanceKey}</span></td><td><a href={'/manage/agents/' + change.agentId + '/rooms/' + encodeURIComponent(change.roomId)}>{change.roomName}</a><span className="subline">{change.roomAlias ?? change.roomId}</span></td>
        <td>{change.before?.accessMode ?? 'none'}{change.before?.powerLevel !== null && change.before?.powerLevel !== undefined ? ' · ' + change.before.powerLevel : ''}{change.before?.muted ? ' · muted' : ''}</td>
        <td>{change.after?.accessMode ?? 'none'}{change.after?.powerLevel !== null && change.after?.powerLevel !== undefined ? ' · ' + change.after.powerLevel : ''}{change.after?.muted ? ' · muted' : ''}</td>
        <td>{change.nativeCreator ? 'Room creator' : change.nativePowerLevel === null ? 'No power change' : 'Level ' + change.nativePowerLevel}</td><td>{change.changed ? change.after === null ? 'Remove access' : 'Change access' : 'Unchanged'}</td></tr>)}</tbody></table></div>}</PageItems>}
  </Panel>;
}
function FleetSettings({ fleet }: { fleet: FleetView }) {
  const viewer = useSession(), action = useAction(), [label, setLabel] = useState(fleet.label);
  return <><Panel title="Display name" description="Change the name shown in management. The fleet key stays the same.">
    <form onSubmit={event => { event.preventDefault(); void action.run(() => call(operations.changeFleet, { fleetId: fleet.fleetId }, { expectedRevision: fleet.revision, label, controller: fleet.controller }, viewer.csrfSecret)); }}>
      <label className="bounded-form">Fleet label<input required maxLength={100} value={label} onChange={event => setLabel(event.target.value)}/></label><div className="actions"><button disabled={action.pending}>Save label</button></div><Alert>{action.error}</Alert></form></Panel>
    <Panel title="Controller and identity" description="The controller reports where this fleet runs; its label does not grant authority."><dl><dt>Controller</dt><dd>{fleet.controller.name}</dd><dt>Owner</dt><dd>{fleet.owner.displayName}<span className="subline">{fleet.owner.matrixUserId}</span></dd><dt>Last updated</dt><dd>{timestamp(fleet.updatedAt)}</dd></dl>
      <Help title="Technical identifiers and controller metadata"><dl><dt>Fleet key</dt><dd>{fleet.fleetKey}</dd><dt>Fleet ID</dt><dd className="mono">{fleet.fleetId}</dd>{Object.entries(fleet.controller.metadata ?? {}).map(([key, value]) => <Fragment key={key}><dt>{key}</dt><dd>{value}</dd></Fragment>)}</dl></Help></Panel>
    <Panel title="Remove grouping" description="Disconnect this controller binding. Agent accounts, room grants and saved sessions remain."><div className="actions"><button type="button" className="danger" disabled={action.pending} onClick={() => {
      if (confirm('Remove this grouping and its controller access? Bound listeners deactivate. Agent accounts, grants and native sessions are retained.')) void action.run(() => call(operations.removeFleet, { fleetId: fleet.fleetId }, { expectedRevision: fleet.revision }, viewer.csrfSecret), () => location.assign('/manage/fleets'));
    }}>Remove fleet grouping</button></div><Alert>{action.error}</Alert></Panel></>;
}
function FleetAgents({ id }: { id: string }) {
  const agents = useResource(operations.fleetAgents, { fleetId: id }, pagingQuery(), 5000);
  return <Panel title="Agents" description="Select an agent to manage its room access, wake-up rules or account."><Loaded {...agents} retry={agents.refresh}>{page => <>
    {page.data.length ? <div className="table-wrap"><table aria-label="Fleet agents"><thead><tr><th scope="col">Agent</th><th scope="col">Instance</th><th scope="col">Listener</th><th scope="col">Account</th></tr></thead><tbody>{page.data.map(instance =>
      <tr key={instance.instanceKey}><td><a className="record-link" href={'/manage/agents/' + instance.agent.agentId}>{instance.agent.displayName}</a></td><td>{instance.instanceKey}</td><td><Status value={instance.agent.activity.status}/></td><td><Status value={instance.agent.status}/></td></tr>)}</tbody></table></div>
      : <Empty title="No agents">There are no agents on this page.</Empty>}<Pagination meta={page.meta}/></>}</Loaded></Panel>;
}
export function FleetDetail({ id, section }: { id: string; section: Exclude<FleetSection, 'map'> }) {
  const resource = useResource(operations.fleet, { fleetId: id }, '', 5000);
  return <Page title="Fleet details" description="Agents, delivery and room access." action={<button onClick={resource.refresh}>Refresh status</button>}><a className="back" href="/manage/fleets">← Fleets</a>
    <Loaded {...resource} retry={resource.refresh}>{({ data: fleet }) => <><SubjectHeading name={fleet.label} description={<>{fleet.owner.displayName} · Controller {fleet.controller.name}</>}><Status value={fleet.delivery.connection.status}/><Status value={fleet.delivery.deliveryEnabled ? 'Delivery enabled' : 'Delivery paused'}/></SubjectHeading>
      <FleetNavigation id={id} section={section}/>{section === 'agents' && <FleetAgents id={id}/>}{section === 'delivery' && <FleetDelivery fleet={fleet}/>} {section === 'sessions' && <FleetSessions fleet={fleet} refresh={resource.refresh}/>} {section === 'messages' && <FleetMessages fleet={fleet}/>} {section === 'rooms' && <RoomPlan fleet={fleet}/>} {section === 'settings' && <FleetSettings fleet={fleet}/>} {section === 'statistics' && <FleetStatistics id={id}/>}
    </>}</Loaded></Page>;
}
