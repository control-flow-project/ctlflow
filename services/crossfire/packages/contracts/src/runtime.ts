import * as check from './schema/validation.js';
import { implementedRuntimes } from '@ctlflow/crossfire-domain/runtime/values';
export const implementedRuntime = check.choice(...implementedRuntimes);
import { MAX_INPUT_BYTES, MAX_REVIEW_BYTES } from '@ctlflow/crossfire-domain/runtime/values';
import type { DecisionCreation, DecisionView, DecisionSummary, DecisionAnswer, RuntimeObservation, RuntimeObservationView } from '@ctlflow/crossfire-domain/runtime/values';
export { INPUT_BYTES, MAX_INPUT_BYTES, MAX_REVIEW_BYTES } from '@ctlflow/crossfire-domain/runtime/values';
export type { DecisionCreation, DecisionView, DecisionSummary, DecisionAnswer, RuntimeObservation, RuntimeObservationView } from '@ctlflow/crossfire-domain/runtime/values';
export const runtimeState = check.choice('idle', 'working', 'waiting-approval', 'waiting-answer', 'failed', 'unavailable', 'sleeping', 'waking');
export const nativeRuntimeSummary = check.object({ state: check.choice('idle', 'working', 'waiting-approval', 'waiting-answer', 'failed', 'unavailable', 'sleeping', 'waking', 'stopped'), observedAt: check.integer(),
  lastActivityAt: check.nullable(check.integer()), historyAvailable: check.nullable(check.boolean) });
export const listenerOptions = check.object({ history_mode: check.optional(check.choice('shared', 'per-room')) });
const option = check.object({ id: check.text(255), label: check.text(1000), description: check.plainText(4000) });
export const decisionQuestion = check.object({ id: check.text(255), title: check.text(1000), prompt: check.plainText(16000),
  secret: check.boolean, allowText: check.boolean, options: check.list(option, 100) });
const decisionFields = { id: check.identifier, runId: check.identifier, runtime: check.name,
  sessionId: check.text(255), requestId: check.text(255), turnId: check.text(255), itemId: check.text(255),
  kind: check.choice('permission', 'question'), action: check.text(255), review: check.refine(check.plainText(MAX_REVIEW_BYTES),
    value => new TextEncoder().encode(value).byteLength <= MAX_REVIEW_BYTES, 'Native review exceeds the separate UTF-8 resource bound'),
  blocking: check.boolean, expiresAt: check.nullable(check.integer()), questions: check.list(decisionQuestion, 100, 1) };
export const decisionCreation = check.object({ ...decisionFields, runtime: implementedRuntime }) satisfies check.Parser<DecisionCreation>;
export const decisionAnswer = check.object({ questionId: check.text(255), optionId: check.nullable(check.text(255)), text: check.nullable(check.plainText(16000)) }) satisfies check.Parser<DecisionAnswer>;
export const decisionSubmission = check.object({ answers: check.list(decisionAnswer, 100, 1) });
export const decisionStatus = check.choice('pending', 'answered', 'responded', 'cancelled', 'expired');
export const decisionView = check.object({ ...decisionFields, agentId: check.identifier, status: decisionStatus, createdAt: check.integer() }) satisfies check.Parser<DecisionView>;
const { review: _review, questions: _questions, ...summaryFields } = decisionFields;
export const decisionSummary = check.object({ ...summaryFields, agentId: check.identifier, status: decisionStatus, createdAt: check.integer() }) satisfies check.Parser<DecisionSummary>;
export const decisionReceipt = check.object({ status: check.choice('responded', 'cancelled') });
export const decisionPoll = check.object({ status: decisionStatus, answers: check.list(decisionAnswer, 100) });
export const setting = check.object({ name: check.text(100), configured: check.nullable(check.text(1000)), effective: check.nullable(check.text(1000)) });
const observationFields = { sessionId: check.text(255), roomId: check.nullable(check.roomId), runtime: check.name, state: runtimeState,
  observedAt: check.integer(), lastActivityAt: check.nullable(check.integer()), historyAvailable: check.nullable(check.boolean),
  historyMode: check.choice('shared', 'per-room'), maxInputBytes: check.integer(1024, MAX_INPUT_BYTES),
  settings: check.list(setting, 100), errorMessage: check.nullable(check.plainText(4000)) };
export const observation = check.object({ ...observationFields, runtime: implementedRuntime }) satisfies check.Parser<RuntimeObservation>;
export const observationView = check.object({ runId: check.identifier, ...observationFields }) satisfies check.Parser<RuntimeObservationView>;
export const observations = check.list(observationView, 2002);
export const failureReport = check.object({ episodeId: check.identifier, agentId: check.identifier, sessionId: check.nullable(check.text(255)), message: check.plainText(4000) });
