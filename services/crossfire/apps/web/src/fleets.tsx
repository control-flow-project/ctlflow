import { Fragment, useState } from 'react';
import type { FleetView } from '@crossfire/contracts/schema/response';
import type { Parsed } from '@crossfire/contracts/schema/validation';
import { preview } from '@crossfire/contracts/schema/plan';
import { parseRoomPlan } from '@crossfire/contracts/room-plan';
import { failure, success } from '@crossfire/kernel/result';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Field, Loaded, Page, Panel, Pagination, PageItems, Status, timestamp, pagingQuery } from './ui.js';
import { OwnerFilter } from './agent-filters.js';
import { filterQuery } from './form.js';
import { FleetDelivery } from './fleet-control.js';
import { FleetNavigation } from './fleet-navigation.js';

export function Fleets() {
  const viewer = useSession(), resource = useResource(operations.fleets, {}, location.search, 5000);
  return <Page title="Fleets" description="Agent deployment groups and their last-reported controllers." action={<button onClick={resource.refresh}>Refresh</button>}>
    <form className="filter-bar" onSubmit={event => { event.preventDefault(); location.assign('/manage/fleets?' + filterQuery(event.currentTarget)); }}><label>Search fleets or controllers<input name="search" type="search" defaultValue={new URLSearchParams(location.search).get('search') ?? ''}/></label>
      {viewer.permissions.includes('agent.read.any') && <OwnerFilter/>}<div className="filter-actions"><button>Apply filters</button><a href="/manage/fleets">Reset</a></div></form>
    <Loaded {...resource} retry={resource.refresh}>{page => <>{page.data.length ? <div className="agent-grid">{page.data.map(fleet =>
      <a key={fleet.fleetId} className="agent-card" href={'/manage/fleets/' + fleet.fleetId}><h2>{fleet.label}</h2><p>{fleet.fleetKey}</p><p className="owner">{fleet.owner.displayName} · {fleet.owner.matrixUserId}</p><dl><dt>Controller</dt><dd>{fleet.controller.name}</dd><dt>Connection</dt><dd><Status value={fleet.delivery.connection.status}/></dd><dt>Delivery</dt><dd>{fleet.delivery.deliveryEnabled ? 'Enabled' : 'Deactivated'}</dd></dl><footer>Agents &amp; room plan →</footer></a>)}</div>
      : <Empty title="No fleets">Register a fleet directory with your fleet controller, then start it to review its enrollment here.</Empty>}<Pagination meta={page.meta}/></>}</Loaded>
    <div className="quiet-note"><strong>Fleet execution</strong><p>Start and stop engines through the fleet CLI. Management can deactivate their listeners or send a direct fleet message.</p></div></Page>;
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
  return <Panel title="Room plan" description="Review the complete desired grants for the listed instances. Omitted grants for those instances are removed.">
    <Field label="Room plan TOML">{id => <textarea id={id} rows={10} value={source} onChange={event => { setSource(event.target.value); setReview(undefined); }} spellCheck={false}/>}</Field>
    <div className="actions"><button disabled={action.pending || !source} onClick={() => { void action.run(inspect, setReview); }}>Preview room access</button>
      <button disabled={action.pending || !review} onClick={() => { if (confirm('Apply this exact room-access diff? Removed grants will lose access.')) void action.run(apply); }}>Apply reviewed plan</button></div><Alert>{action.error}</Alert>
    {review && <PageItems items={review.value.changes} parameter="planPage">{changes => <div className="table-wrap"><table><thead><tr><th>Agent</th><th>Room</th><th>Current</th><th>Desired</th><th>Native authority</th><th>Change</th></tr></thead><tbody>{changes.map(change =>
      <tr key={change.agentId + change.roomId}><td><a href={'/manage/agents/' + change.agentId}>{change.agentName}</a><span className="subline">{change.instanceKey}</span></td><td><a href={'/manage/agents/' + change.agentId + '/rooms/' + encodeURIComponent(change.roomId)}>{change.roomName}</a><span className="subline">{change.roomAlias ?? change.roomId}</span></td>
        <td>{change.before?.accessMode ?? 'none'}{change.before?.powerLevel !== null && change.before?.powerLevel !== undefined ? ' · ' + change.before.powerLevel : ''}{change.before?.muted ? ' · muted' : ''}</td>
        <td>{change.after?.accessMode ?? 'none'}{change.after?.powerLevel !== null && change.after?.powerLevel !== undefined ? ' · ' + change.after.powerLevel : ''}{change.after?.muted ? ' · muted' : ''}</td>
        <td>{change.nativeCreator ? 'Room creator' : change.nativePowerLevel === null ? 'No power change' : 'Level ' + change.nativePowerLevel}</td><td>{change.changed ? change.after === null ? 'Remove access' : 'Change access' : 'Unchanged'}</td></tr>)}</tbody></table></div>}</PageItems>}
  </Panel>;
}
function FleetSettings({ fleet }: { fleet: FleetView }) {
  const viewer = useSession(), action = useAction(), [label, setLabel] = useState(fleet.label);
  return <Panel title="Controller and identity"><dl><dt>Controller (last reported)</dt><dd>{fleet.controller.name}</dd><dt>Owner</dt><dd>{fleet.owner.displayName}<span className="subline">{fleet.owner.matrixUserId}</span></dd>
    <dt>Last reported</dt><dd>{timestamp(fleet.updatedAt)}</dd>{Object.entries(fleet.controller.metadata ?? {}).map(([key, value]) => <Fragment key={key}><dt>{key}</dt><dd>{value}</dd></Fragment>)}</dl>
    <form onSubmit={event => { event.preventDefault(); void action.run(() => call(operations.changeFleet, { fleetId: fleet.fleetId }, { expectedRevision: fleet.revision, label, controller: fleet.controller }, viewer.csrfSecret)); }}>
      <label>Fleet label<input required maxLength={100} value={label} onChange={event => setLabel(event.target.value)}/></label><div className="actions"><button disabled={action.pending}>Save label</button>
        <button type="button" className="danger" disabled={action.pending} onClick={() => { if (confirm('Remove this grouping and its controller access? Bound listeners deactivate. Agent accounts, grants and native sessions are retained.')) void action.run(() => call(operations.removeFleet, { fleetId: fleet.fleetId }, { expectedRevision: fleet.revision }, viewer.csrfSecret), () => location.assign('/manage/fleets')); }}>Remove fleet grouping</button></div><Alert>{action.error}</Alert></form></Panel>;
}
export function FleetDetail({ id }: { id: string }) {
  const resource = useResource(operations.fleet, { fleetId: id }, '', 5000), agents = useResource(operations.fleetAgents, { fleetId: id }, pagingQuery(), 5000);
  return <Page title="Fleet details" description="Controller, agents and room access."><a className="back" href="/manage/fleets">← Fleets</a>
    <FleetNavigation id={id}/>
    <Loaded {...resource} retry={resource.refresh}>{result => <><FleetDelivery fleet={result.data}/><FleetSettings fleet={result.data}/><Panel title="Agents"><Loaded {...agents} retry={agents.refresh}>{page => <>
      {page.data.length ? <div className="table-wrap"><table aria-label="Fleet agents"><thead><tr><th scope="col">Agent</th><th scope="col">Instance</th><th scope="col">Listener</th><th scope="col">Account</th></tr></thead><tbody>{page.data.map(instance =>
        <tr key={instance.instanceKey}><td><a href={'/manage/agents/' + instance.agent.agentId}>{instance.agent.displayName}</a></td><td>{instance.instanceKey}</td><td><Status value={instance.agent.activity.status}/></td><td><Status value={instance.agent.status}/></td></tr>)}</tbody></table></div>
        : <Empty title="No agents">There are no agents on this page.</Empty>}<Pagination meta={page.meta}/></>}</Loaded></Panel><RoomPlan fleet={result.data}/></>}</Loaded></Page>;
}
