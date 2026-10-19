import type { RuntimeDecision } from '@ctlflow/crossfire-agent-core/runtime';
import type { NativeRequest } from './protocol.js';
import type { Json } from '@ctlflow/crossfire-kernel/json';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { object, text } from '@ctlflow/crossfire-contracts/validation';
import { decisionQuestion } from '@ctlflow/crossfire-contracts/runtime';

export function codexQuestion(request: NativeRequest, session: string): Result<RuntimeDecision> {
  const params = request.params;
  if (params.threadId !== session || !text(params.turnId, 255) || !text(params.itemId, 255)
    || !Array.isArray(params.questions) || !params.questions.length || params.questions.length > 100) return failure('invalid', 'Invalid native question attribution');
  const questions: NonNullable<RuntimeDecision['questions']> = [];
  for (const value of params.questions) {
    const row = object(value);
    if (!row.ok || !text(row.value.id, 255) || !Array.isArray(row.value.options) && row.value.options !== null
      || typeof row.value.isOther !== 'boolean' || typeof row.value.isSecret !== 'boolean') return failure('invalid', 'Invalid native question');
    const options = row.value.options === null ? [] : (row.value.options as unknown[]).map((value, index) => {
      const option = object(value);
      return option.ok ? { id: String(index), label: option.value.label, description: option.value.description } : null;
    });
    const parsed = decisionQuestion({ id: row.value.id, title: row.value.header, prompt: row.value.question,
      secret: row.value.isSecret, allowText: row.value.isOther || row.value.options === null, options });
    if (!parsed.ok || questions.some(question => question.id === parsed.value.id)) return failure('invalid', 'Invalid or duplicate native question');
    questions.push(parsed.value);
  }
  if (typeof params.isBlocking !== 'boolean' || params.autoResolutionMs !== undefined && params.autoResolutionMs !== null
    && (!Number.isSafeInteger(params.autoResolutionMs) || Number(params.autoResolutionMs) < 0)) return failure('invalid', 'Invalid native question lifetime');
  return success({ runtime: 'codex', session, request: JSON.stringify([typeof request.id, request.id]), action: 'Human input',
    scope: { questions: questions.map(question => ({ ...question })) } as Json, choices: [], questions,
    turn: params.turnId as string, item: params.itemId as string, blocking: params.isBlocking,
    expiresMs: params.autoResolutionMs === null || params.autoResolutionMs === undefined ? null : Number(params.autoResolutionMs) });
}

export function validQuestionAnswer(permission: RuntimeDecision, value: Json): boolean {
  const response = object(value), answers = response.ok ? object(response.value.answers) : response;
  if (!answers.ok || !permission.questions || Object.keys(answers.value).length !== permission.questions.length) return false;
  return permission.questions.every(question => {
    const answer = object(answers.value[question.id]);
    if (!answer.ok || !Array.isArray(answer.value.answers) || answer.value.answers.length !== 1 || typeof answer.value.answers[0] !== 'string') return false;
    const selected = answer.value.answers[0];
    return question.allowText || question.options.some(option => option.label === selected);
  });
}
