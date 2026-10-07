import type { AgentView } from '@ctlflow/crossfire-contracts/schema/response';
import { Status, timestamp } from './ui.js';

const labels = { idle: 'Idle', working: 'Working', 'waiting-approval': 'Waiting for approval', 'waiting-answer': 'Waiting for an answer',
  failed: 'Failed', unavailable: 'Unavailable', sleeping: 'Sleeping', waking: 'Waking', stopped: 'Stopped' } as const;

export function NativeStatus({ state }: { state: NonNullable<AgentView['nativeRuntime']>['state'] }) {
  return <Status value={labels[state]}/>;
}
export function savedHistoryLabel(available: boolean | null): string {
  return available === null ? 'Not reported' : available ? 'Available for resume' : 'Not available for resume';
}
export function NativeRuntimeStatus({ agent, compact = false }: { agent: AgentView; compact?: boolean }) {
  const summary = agent.nativeRuntime;
  if (agent.activity.status !== 'online' && summary?.state !== 'stopped') return <><Status value="Unknown"/>{!compact && <span className="subline">
    {summary ? 'Last reported: ' + labels[summary.state] + ' · ' + timestamp(summary.observedAt) : 'No native observation'}<br/>Not currently reporting
    <br/>{summary?.historyAvailable === null || !summary ? 'History not reported' : savedHistoryLabel(summary.historyAvailable)}</span>}</>;
  return summary ? <span title={'Observed ' + timestamp(summary.observedAt)}>
    {summary.state === 'failed' || summary.state === 'unavailable' || summary.state === 'waiting-approval' || summary.state === 'waiting-answer' ? <a href={'/manage/agents/' + agent.agentId + '/session'} aria-label={'Inspect native runtime for ' + agent.displayName}><NativeStatus state={summary.state}/></a> : <NativeStatus state={summary.state}/>}
    {!compact && <span className="subline">{summary.state === 'stopped' ? 'Confirmed stopped · ' + timestamp(summary.observedAt) : summary.lastActivityAt === null ? 'Activity not reported' : 'Last active ' + timestamp(summary.lastActivityAt)}
      <br/>{summary.historyAvailable === null ? 'History not reported' : savedHistoryLabel(summary.historyAvailable)}</span>}</span>
    : <><Status value="Unknown"/>{!compact && <span className="subline">No native observation</span>}</>;
}
export function NativeRuntimeDetails({ agent }: { agent: AgentView }) {
  const summary = agent.nativeRuntime;
  return <dl className="detail-list"><dt>Native state</dt><dd><NativeRuntimeStatus agent={agent} compact/></dd>
    {summary && agent.activity.status !== 'online' && summary.state !== 'stopped' && <><dt>Last reported state</dt><dd>{labels[summary.state]} (historical)</dd></>}
    <dt>Observed</dt><dd>{summary ? timestamp(summary.observedAt) : 'Not reported'}</dd>
    <dt>Last activity</dt><dd>{summary === null || summary.lastActivityAt === null ? 'Not reported' : timestamp(summary.lastActivityAt)}</dd>
    <dt>Saved history</dt><dd>{savedHistoryLabel(summary?.historyAvailable ?? null)}</dd></dl>;
}
