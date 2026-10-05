import type { RuntimeObservationView } from '@crossfire/contracts/runtime';
import type { AgentView } from '@crossfire/contracts/schema/response';
import { Status, timestamp } from './ui.js';

const labels = { idle: 'Idle', working: 'Working', 'waiting-approval': 'Waiting for approval', 'waiting-answer': 'Waiting for an answer',
  failed: 'Failed', unavailable: 'Unavailable', sleeping: 'Sleeping', waking: 'Waking' } as const;

export function NativeStatus({ state }: { state: RuntimeObservationView['state'] }) {
  return <Status value={labels[state]}/>;
}
export function savedHistoryLabel(available: boolean | null): string {
  return available === null ? 'Not reported' : available ? 'Available for resume' : 'Not available for resume';
}
export function NativeRuntimeStatus({ agent, compact = false }: { agent: AgentView; compact?: boolean }) {
  const summary = agent.nativeRuntime;
  return summary ? <span title={'Observed ' + timestamp(summary.observedAt)}>
    {summary.state === 'failed' || summary.state === 'unavailable' ? <a href={'/manage/agents/' + agent.agentId + '/runtime'} aria-label={'Inspect native runtime for ' + agent.displayName}><NativeStatus state={summary.state}/></a> : <NativeStatus state={summary.state}/>}
    {!compact && <span className="subline">{agent.activity.status !== 'online' ? 'Last reported · ' : ''}{summary.lastActivityAt === null ? 'Activity not reported' : 'Last active ' + timestamp(summary.lastActivityAt)}
      <br/>{summary.historyAvailable === null ? 'History not reported' : savedHistoryLabel(summary.historyAvailable)}</span>}</span>
    : <><Status value="Unknown"/>{!compact && <span className="subline">No native observation</span>}</>;
}
export function NativeRuntimeDetails({ agent }: { agent: AgentView }) {
  const summary = agent.nativeRuntime;
  return <dl className="detail-list"><dt>Native state</dt><dd>{summary ? <NativeStatus state={summary.state}/> : 'Not reported'}</dd>
    <dt>Observed</dt><dd>{summary ? timestamp(summary.observedAt) : 'Not reported'}</dd>
    <dt>Last activity</dt><dd>{summary === null || summary.lastActivityAt === null ? 'Not reported' : timestamp(summary.lastActivityAt)}</dd>
    <dt>Saved history</dt><dd>{savedHistoryLabel(summary?.historyAvailable ?? null)}</dd></dl>;
}
