import { operations, useResource } from '../api.js';
import { useSession } from '../session.js';
import { Page, Loaded, Empty, Pagination, Status, timestamp } from '../ui.js';
import { WakeForm } from './form.js';
import { scheduleLabel } from './schedule.js';

export function WakeUps() {
  const viewer = useSession();
  const resource = useResource(operations.wakeRules, {}, location.search, 30_000);
  const search = new URLSearchParams(location.search).get('search') ?? '';
  return <Page title="Wake-ups" description="Scheduled messages for connected agents—by interval or calendar."
    action={<><button onClick={resource.refresh}>Refresh</button><a className="button primary" href="/manage/wake-ups/new">New Wake-up</a></>}>
    <form className="filter-bar"><label>Search Wake-ups<input type="search" name="search" defaultValue={search}/></label><button>Search</button><a href="/manage/wake-ups">Reset</a></form>
    <Loaded {...resource} retry={resource.refresh}>{result => <>{result.data.length ? <div className="table-wrap"><table aria-label="Wake-ups"><thead><tr><th>Name</th><th>Schedule</th>{viewer.member.roleCode === 'administrator' && <th>Owner</th>}<th>Agents</th><th>Status</th><th>Next due</th><th>Last delivered</th></tr></thead><tbody>{result.data.map(rule => <tr key={rule.ruleId}>
      <td><a className="record-link" href={'/manage/wake-ups/' + rule.ruleId}>{rule.name}</a></td><td>{scheduleLabel(rule.schedule)}</td>{viewer.member.roleCode === 'administrator' && <td>{rule.owner.displayName}</td>}<td>{rule.agentCount}</td><td><Status value={rule.enabled ? 'Enabled' : 'Disabled'}/></td><td>{rule.nextDueAt === null ? '—' : timestamp(rule.nextDueAt)}</td><td>{rule.lastDeliveredAt === null ? 'Not delivered' : timestamp(rule.lastDeliveredAt)}</td>
    </tr>)}</tbody></table></div> : <Empty title="No Wake-ups">Create a schedule, write its message and choose which agents receive it.</Empty>}<Pagination meta={result.meta}/></>}</Loaded>
  </Page>;
}
export function WakeUpDetail({ id }: { id?: string }) {
  return <Page title={id ? 'Wake-up details' : 'New Wake-up'} description="Choose when to run, what to send and which agents receive it.">
    <a className="back" href="/manage/wake-ups">← Wake-ups</a>
    {id ? <ExistingWakeUp id={id}/> : <WakeForm/>}
  </Page>;
}
function ExistingWakeUp({ id }: { id: string }) {
  const resource = useResource(operations.wakeRule, { ruleId: id });
  return <Loaded {...resource} retry={resource.refresh}>{result => <WakeForm key={result.data.ruleId + ':' + result.data.revision} rule={result.data}/>}</Loaded>;
}
