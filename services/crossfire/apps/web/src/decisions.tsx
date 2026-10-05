import { useState } from 'react';
import { call, operations, useAction, useResource } from './api.js';
import { Alert, Loaded, Page, Panel, Pagination, Status, timestamp, pagingQuery } from './ui.js';
import { useSession } from './session.js';
import type { DecisionView, DecisionSummary, DecisionAnswer } from '@ctlflow/crossfire-contracts/runtime';

function DecisionTable({ id, decisions, label }: { id: string; decisions: DecisionSummary[]; label: string }) {
  return <div className="table-wrap"><table aria-label={label}><thead><tr><th>Request</th><th>State</th><th>Native behavior</th><th>Created</th></tr></thead><tbody>
    {decisions.map(decision => <tr key={decision.id}><td><a href={'/manage/agents/' + id + '/decisions/' + decision.id}>{decision.action}</a><span className="subline">{decision.kind}</span></td>
      <td><Status value={decision.status}/></td><td>{decision.blocking ? 'Blocking' : 'Nonblocking'}</td><td>{timestamp(decision.createdAt)}</td></tr>)}</tbody></table></div>;
}
function DecisionHistory({ id }: { id: string }) {
  const rows = useResource(operations.runtimeDecisions, { agentId: id }, pagingQuery('decisionsPage'), 10000);
  return <Loaded {...rows} retry={rows.refresh}>{response => <>{response.data.length
    ? <DecisionTable id={id} decisions={response.data} label="Decision history"/>
    : <p className="muted">No native requests have been recorded.</p>}<Pagination parameter="decisionsPage" meta={response.meta}/></>}</Loaded>;
}
export function Decisions({ id }: { id: string }) {
  const rows = useResource(operations.runtimeDecisions, { agentId: id }, pagingQuery('pendingPage') + '&status=pending', 5000);
  const [history, setHistory] = useState(new URLSearchParams(location.search).has('decisionsPage'));
  return <Panel title="Decisions" description="Permission requests and questions appear here and in the private owner conversation. Only the owner can answer.">
    <Loaded {...rows} retry={rows.refresh}>{response => <>{response.data.length ? <>
      <p className="decision-attention" role="status">Answer blocking requests so the agent can continue. Review each request’s scope before submitting.</p>
      <DecisionTable id={id} decisions={response.data} label="Pending decisions"/><Pagination parameter="pendingPage" meta={response.meta}/>
    </> : <p className="muted">No requests are waiting for an answer.</p>}</>}</Loaded>
    <details className="session-disclosure" open={history} onToggle={event => setHistory(event.currentTarget.open)}><summary>Decision history</summary>{history && <DecisionHistory id={id}/>}</details>
  </Panel>;
}
function Answer({ decision }: { decision: DecisionView }) {
  const viewer = useSession(), action = useAction();
  const agent = useResource(operations.agent, { agentId: decision.agentId });
  const [answers, setAnswers] = useState<Record<string, DecisionAnswer>>({});
  const hint = new URLSearchParams(location.search).get('choice');
  const [submitted, setSubmitted] = useState(false);
  const editable = agent.result?.ok === true && agent.result.value.data.owner.memberId === viewer.member.memberId && decision.status === 'pending' && !submitted;
  return <><Alert>{action.error}</Alert>
    <p>{submitted ? 'Answer submitted. Native response publication is reported separately; this is not proof that execution has resumed.' : decision.status !== 'pending' ? 'This native request is no longer accepting answers.' : 'Opening this page does not answer the request. Review the original scope and submit explicitly.'}</p>
    <dl className="detail-list"><dt>State</dt><dd><Status value={decision.status}/></dd><dt>Runtime</dt><dd>{decision.runtime}</dd><dt>Session</dt><dd><code>{decision.sessionId}</code></dd>
      <dt>Turn / item</dt><dd><code>{decision.turnId}</code> / <code>{decision.itemId}</code></dd><dt>Native behavior</dt><dd>{decision.blocking ? 'Blocking' : 'Nonblocking'} · {decision.expiresAt === null ? 'No native expiry' : 'Expires ' + timestamp(decision.expiresAt)}</dd></dl>
    <details><summary>Complete native request scope</summary><pre className="native-review">{decision.review}</pre></details>
    <form onSubmit={event => {
      event.preventDefault();
      void action.run(() => call(operations.answerRuntimeDecision, { agentId: decision.agentId, decisionId: decision.id },
        { answers: decision.questions.map(question => answers[question.id]!).filter(Boolean) }, viewer.csrfSecret), () => { setSubmitted(true); setAnswers({}); });
    }}>
      {decision.questions.map(question => <fieldset key={question.id} disabled={!editable || action.pending}>
        <legend>{question.title}</legend><p>{question.prompt}</p>
        {question.options.map(option => <label className="check" key={option.id}><input type="radio" name={question.id}
          checked={answers[question.id]?.optionId === option.id} onChange={() => setAnswers(current => ({ ...current, [question.id]: { questionId: question.id, optionId: option.id, text: null } }))}/>
          <span>{option.label}{option.description && <span className="subline">{option.description}</span>}{decision.questions.length === 1 && hint === option.id && <span className="subline">Choice referenced by the link; not selected automatically.</span>}</span></label>)}
        {question.allowText && <label>{question.secret ? 'Private answer' : 'Your answer'}<input type={question.secret ? 'password' : 'text'} autoComplete="off" value={answers[question.id]?.text ?? ''}
          onChange={event => setAnswers(current => ({ ...current, [question.id]: { questionId: question.id, optionId: null, text: event.target.value } }))}/></label>}
      </fieldset>)}
      <button className="primary" disabled={!editable || action.pending || decision.questions.some(question => !answers[question.id])}>Submit answer</button>
    </form></>;
}
export function DecisionDetail({ agentId, decisionId }: { agentId: string; decisionId: string }) {
  const request = useResource(operations.runtimeDecision, { agentId, decisionId }, '', 10000);
  return <Page title="Native decision" description="Review the exact request and answer as its owner."><a className="back" href={'/manage/agents/' + agentId + '/session'}>← Agent session</a>
    <Loaded {...request} retry={request.refresh}>{response => <Panel title={response.data.action}><Answer key={response.data.id} decision={response.data}/></Panel>}</Loaded></Page>;
}
