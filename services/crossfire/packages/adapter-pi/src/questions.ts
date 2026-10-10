import type { RuntimeDecision, RuntimeHooks } from '@ctlflow/crossfire-agent-core/runtime';
import { decisionQuestion } from '@ctlflow/crossfire-contracts/runtime';
import { failureError } from '@ctlflow/crossfire-kernel/result';
import type { PiProcess } from './protocol.js';
import { record } from './protocol.js';

export function piQuestion(event: Record<string, unknown>, session: string, turn: string): RuntimeDecision {
  if (typeof event.id !== 'string' || !event.id || typeof event.title !== 'string'
    || !['confirm', 'select', 'input', 'editor'].includes(String(event.method))) throw failureError({ code: 'invalid', message: 'Invalid native Pi question identity or method' });
  const values = event.method === 'confirm' ? ['Yes', 'No'] : event.method === 'select' ? event.options : [];
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string') || new Set(values).size !== values.length) throw failureError({ code: 'invalid', message: 'Invalid native Pi options' });
  const separator = event.title.indexOf('\n');
  const title = separator < 0 ? event.title : event.title.slice(0, separator);
  const question = decisionQuestion({ id: event.id, title,
    prompt: typeof event.message === 'string' ? event.message : typeof event.placeholder === 'string' ? event.placeholder
      : typeof event.prefill === 'string' ? event.prefill : separator < 0 ? event.title : event.title.slice(separator + 1),
    secret: false, allowText: event.method === 'input' || event.method === 'editor', options: values.map((label, index) => ({ id: String(index), label, description: '' })) });
  if (!question.ok) throw failureError({ code: 'invalid', message: 'Pi question exceeds the native decision contract: ' + question.error.message });
  if (event.timeout !== undefined && (!Number.isSafeInteger(event.timeout) || Number(event.timeout) < 0 || Number(event.timeout) > 2147483647)) throw failureError({ code: 'invalid', message: 'Invalid native Pi question timeout' });
  return { runtime: 'pi', session, request: event.id, turn, item: event.id, action: 'Human input',
    scope: { method: String(event.method), questions: [question.value] }, choices: [], questions: [question.value], blocking: true,
    expiresMs: event.timeout === undefined || event.timeout === 0 ? null : Number(event.timeout) };
}
export async function answerPiQuestion(native: PiProcess, hooks: RuntimeHooks, decision: RuntimeDecision, signal: AbortSignal): Promise<void> {
  const result = await hooks.requestDecision(decision, signal);
  signal.throwIfAborted();
  if (!result.ok) { await native.notify({ type: 'extension_ui_response', id: decision.request, cancelled: true }); return; }
  const answers = record(record(result.value).answers), selected = record(answers[decision.request]);
  if (Object.keys(answers).length !== 1 || !Array.isArray(selected.answers) || selected.answers.length !== 1 || typeof selected.answers[0] !== 'string') throw new Error('Owner answer does not match the original Pi question');
  const answer = selected.answers[0];
  if (!decision.questions![0]!.allowText && !decision.questions![0]!.options.some(option => option.label === answer)) throw new Error('Owner answer is not a native Pi choice');
  await native.notify({ type: 'extension_ui_response', id: decision.request,
    ...(record(decision.scope).method === 'confirm' ? { confirmed: answer === 'Yes' } : { value: answer }) });
  hooks.decisionResponded?.(decision);
}
