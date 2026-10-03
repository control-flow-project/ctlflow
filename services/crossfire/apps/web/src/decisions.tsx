import { useState } from 'react';
import { call, operations, useAction, useResource } from './api.js';
import { Alert, Empty, Loaded, Page, Panel, Pagination, Status, timestamp, pagingQuery } from './ui.js';
import { useSession } from './session.js';
import type { DecisionView, DecisionAnswer } from '@crossfire/contracts/runtime';

export function Decisions({ id }: { id: string }) {
  const rows = useResource(operations.runtimeDecisions, { agentId: id }, pagingQuery('decisionsPage'), 10000);
  return <Panel title="Decisions" description="Native permission requests and structured questions. Only the agent's owner can answer.">
    <Loaded {...rows} retry={rows.refresh}>{response => <>
      {response.data.length ? <div className="table-wrap"><table aria-label="Native decisions"><thead><tr><th>Request</th><th>State</th><th>Native behavior</th><th>Created</th></tr></thead><tbody>
        {response.data.map(decision => <tr key={decision.id}><td><a href={'/manage/agents/' + id + '/decisions/' + decision.id}>{decision.action}</a><span className="subline">{decision.kind}</span></td>
          <td><Status value={decision.status}/></td><td>{decision.blocking ? 'Blocking' : 'Nonblocking'}</td><td>{timestamp(decision.createdAt)}</td></tr>)}</tbody></table></div>
        : <Empty title="No decisions">Native requests appear here and in the private owner conversation.</Empty>}<Pagination parameter="decisionsPage" meta={response.meta}/>
    </>}</Loaded>
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
  return <Page title="Native decision" description="Review the exact request and answer as its owner."><a className="back" href={'/manage/agents/' + agentId + '/decisions'}>← Decisions</a>
    <Loaded {...request} retry={request.refresh}>{response => <Panel title={response.data.action}><Answer key={response.data.id} decision={response.data}/></Panel>}</Loaded></Page>;
}
