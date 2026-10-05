import type { DecisionCreation, DecisionAnswer, DecisionView, DecisionSummary } from './values.js';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Actor, Services } from '../port/services.js';
import { authorize, authorizeAgent } from '../authorization/authorize.js';
import { HEARTBEAT_EXPIRY_MS } from '../listener/report.js';
import { recordEvent } from '../audit/record-event.js';

export function liveRun(services: Services, agentId: string, runId: string) {
  const run = services.repositories.listenerRun.find({ id: runId });
  if (!run.ok) return run;
  return run.value && run.value.agentId === agentId && run.value.stoppedAt === null && run.value.disconnectRequestedAt === null
    && run.value.lastSeenAt + HEARTBEAT_EXPIRY_MS > services.clock.now() ? success(run.value) : failure('conflict', 'The original listener is no longer available');
}
function sameDecision(original: DecisionCreation, input: DecisionCreation): boolean {
  const fields = ['id', 'runId', 'runtime', 'sessionId', 'requestId', 'turnId', 'itemId', 'kind', 'action', 'review', 'blocking', 'expiresAt'] as const;
  return fields.every(field => original[field] === input[field]) && original.questions.length === input.questions.length
    && original.questions.every((question, position) => {
      const selected = input.questions[position]!;
      return question.id === selected.id && question.title === selected.title && question.prompt === selected.prompt
        && question.secret === selected.secret && question.allowText === selected.allowText && question.options.length === selected.options.length
        && question.options.every((option, index) => {
          const offered = selected.options[index]!;
          return option.id === offered.id && option.label === offered.label && option.description === offered.description;
        });
    });
}
function currentDecision<Value extends DecisionSummary>(services: Services, value: Value): Result<Value> {
  if (value.status !== 'pending' && value.status !== 'answered') return success(value);
  const run = liveRun(services, value.agentId, value.runId);
  if (!run.ok && run.error.code !== 'conflict') return run;
  if (value.expiresAt !== null && value.expiresAt <= services.clock.now() || !run.ok) {
    return success({ ...value, status: 'expired' as const });
  }
  return success(value);
}
export function createDecision(services: Services, actor: Actor, agentId: string, input: DecisionCreation) {
  return services.unitOfWork.run(() => {
    const authority = authorize(services, actor, 'runtime.report.self');
    if (!authority.ok) return authority;
    if (actor.principalId !== agentId) return failure('missing', 'Agent not found');
    const run = liveRun(services, agentId, input.runId);
    if (!run.ok) return run;
    if (input.expiresAt !== null && input.expiresAt <= services.clock.now()) return failure('conflict', 'The native decision has already expired');
    if (new Set(input.questions.map(question => question.id)).size !== input.questions.length
      || input.questions.some(question => new Set(question.options.map(option => option.id)).size !== question.options.length
        || !question.allowText && !question.options.length)) return failure('invalid', 'Native questions need unique identities and an answer mechanism');
    const previous = services.runtime.decision(input.id);
    if (!previous.ok) return previous;
    if (previous.value) {
      return previous.value.agentId === agentId && sameDecision(previous.value, input) ? currentDecision(services, previous.value) : failure('conflict', 'Decision identity is already bound to another native request');
    }
    const value: DecisionView = { ...input, agentId, createdAt: services.clock.now(), status: 'pending' };
    const saved = services.runtime.insertDecision(value);
    return saved.ok ? success(value) : saved;
  });
}
export function readDecision(services: Services, actor: Actor, agentId: string, id: string) {
  const authority = authorizeAgent(services, actor, agentId, 'read');
  if (!authority.ok) return authority;
  const result = services.runtime.decision(id);
  if (!result.ok) return result;
  return result.value?.agentId === agentId ? services.unitOfWork.run(() => currentDecision(services, result.value!)) : failure('missing', 'Decision not found');
}
export function listDecisions(services: Services, actor: Actor, agentId: string, query: { page: number; pageSize: number }) {
  const authority = authorizeAgent(services, actor, agentId, 'read');
  if (!authority.ok) return authority;
  const values = services.runtime.decisions(agentId, query.page, query.pageSize);
  if (!values.ok) return values;
  return services.unitOfWork.run(() => {
    const items: DecisionSummary[] = [];
    for (const value of values.value.items) { const current = currentDecision(services, value); if (!current.ok) return current; items.push(current.value); }
    return success({ ...query, items, totalItems: values.value.totalItems, totalPages: Math.max(1, Math.ceil(values.value.totalItems / query.pageSize)) });
  });
}
export function answerDecision(services: Services, actor: Actor, agentId: string, id: string, input: { answers: DecisionAnswer[] }, requestId: string) {
  return services.unitOfWork.run(() => {
    const authority = authorize(services, actor, 'runtime.decision.answer.owned');
    if (!authority.ok) return authority;
    const agent = services.repositories.agent.find({ principalId: agentId });
    if (!agent.ok) return agent;
    if (actor.kind !== 'human' || agent.value?.ownerId !== actor.principalId) return failure('missing', 'Owner decision not found');
    const decision = readDecision(services, actor, agentId, id);
    if (!decision.ok) return decision;
    if (decision.value.status !== 'pending') return failure('conflict', 'This native request is no longer pending');
    const questions = decision.value.questions;
    if (input.answers.length !== questions.length || new Set(input.answers.map(answer => answer.questionId)).size !== questions.length) return failure('invalid', 'Answer every native question exactly once');
    for (const question of questions) {
      const answer = input.answers.find(answer => answer.questionId === question.id);
      if (!answer || (answer.optionId === null) === (answer.text === null)
        || answer.optionId !== null && !question.options.some(option => option.id === answer.optionId)
        || answer.text !== null && (!question.allowText || !answer.text.trim())) return failure('invalid', 'Answer is not one of the native choices');
    }
    const saved = services.runtime.answer(id, input.answers);
    if (!saved.ok) return saved;
    const audited = recordEvent(services, actor, requestId, { targetKind: 'runtime-decision', targetId: id,
      ownerId: actor.principalId, action: 'runtime-decision.answer', message: 'Owner submitted a native answer; answer content is private.' });
    return audited.ok ? success({ accepted: true }) : audited;
  });
}
export function pollDecision(services: Services, actor: Actor, agentId: string, id: string) {
  const authority = authorize(services, actor, 'runtime.report.self');
  if (!authority.ok) return authority;
  if (actor.principalId !== agentId) return failure('missing', 'Decision not found');
  const current = readDecision(services, actor, agentId, id);
  if (!current.ok) return current;
  const answers = current.value.status === 'answered' ? services.runtime.answers(id) : success([]);
  return answers.ok ? success({ status: current.value.status, answers: answers.value }) : answers;
}
export function receiptDecision(services: Services, actor: Actor, agentId: string, id: string, status: 'responded' | 'cancelled') {
  return services.unitOfWork.run(() => {
    const authority = authorize(services, actor, 'runtime.report.self');
    if (!authority.ok) return authority;
    if (actor.principalId !== agentId) return failure('missing', 'Decision not found');
    const decision = services.runtime.decision(id);
    if (!decision.ok) return decision;
    if (decision.value?.agentId !== agentId) return failure('missing', 'Decision not found');
    if (status === 'responded' && decision.value.status !== 'answered' && decision.value.status !== 'responded') return failure('conflict', 'No answer was submitted to this native request');
    if (status === 'cancelled' && !['pending', 'answered', 'cancelled'].includes(decision.value.status)) return failure('conflict', 'The native request is already settled');
    const saved = services.runtime.decisionStatus(id, status);
    return saved.ok ? success({ accepted: true }) : saved;
  });
}
export function expireDecisions(services: Services) {
  return services.unitOfWork.run(() => {
    const pending = services.runtime.pendingDecisions();
    if (!pending.ok) return pending;
    for (const decision of pending.value) {
      const current = currentDecision(services, decision);
      if (!current.ok) return current;
      if (current.value.status !== 'expired') continue;
      const saved = services.runtime.decisionStatus(decision.id, 'expired');
      if (!saved.ok) return saved;
    }
    return success(undefined);
  });
}
