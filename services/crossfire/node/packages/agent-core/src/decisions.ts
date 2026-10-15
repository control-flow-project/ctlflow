import { randomUUID } from 'node:crypto';
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import { ownerNotice, ownerNoticeChunks } from './owner-notices.js';
import { failure, failureError, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Json } from '@ctlflow/crossfire-contracts/json';
import type { RuntimeDecision } from './runtime.js';
import type { Clock, Matrix, LocalState } from './port.js';
import type { Coordination } from './coordination.js';
import type { Settings } from '@ctlflow/crossfire-contracts/client';
import { ownerConversationState, roomState, roomPowers } from '@ctlflow/crossfire-contracts/matrix-room';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';

const journal = check.list(check.object({ id: check.identifier, native: check.text(1000),
  status: check.choice('pending', 'responded', 'cancelled') }), 4096);
export function decisions(options: { clock: Clock; client: Matrix; coordination: Coordination; settings: Settings;
  agent: string; matrixUserId: string; run: () => Promise<string>; storage: LocalState; file: string }, stop: AbortSignal) {
  let receipts: check.Parsed<typeof journal>;
  try {
    const loaded = journal(options.storage.exists(options.file) ? options.storage.read(options.file) : []);
    if (!loaded.ok) throw failureError(loaded.error);
    receipts = loaded.value;
  } catch { throw failureError({ code: 'invalid', message: 'Invalid native decision journal; retained decisions require owner inspection' }); }
  const pending = new Set<string>();
  const key = (decision: RuntimeDecision) => JSON.stringify([decision.runtime, decision.session, decision.request]);
  const save = () => options.storage.write(options.file, receipts);
  const unresolved = () => receipts.some(receipt => receipt.status === 'pending');
  let started = false;
  let running: Promise<void> | undefined;
  async function flush(signal: AbortSignal): Promise<void> {
    for (const receipt of [...receipts]) {
      if (receipt.status === 'pending') continue;
      const result = await options.coordination.receiptDecision(options.agent, receipt.id, receipt.status, signal);
      if (result.ok || result.error.code === 'missing' || result.error.code === 'conflict') {
        receipts.splice(receipts.indexOf(receipt), 1); save();
      }
    }
  }
  function start(): void {
    if (started) return;
    started = true;
    for (const receipt of receipts) if (receipt.status === 'pending') receipt.status = 'cancelled';
    save();
    running = (async () => {
      while (!stop.aborted) {
        try { await flush(AbortSignal.any([stop, options.clock.deadline(15000)])); } catch { if (stop.aborted) break; }
        await options.clock.delay(1000, stop);
      }
    })().catch(() => undefined);
  }
  async function authorize(): Promise<Result<void>> {
    const delivery = await options.coordination.delivery(options.agent, stop);
    if (!delivery.ok) return delivery;
    if (delivery.value.agentId !== options.agent || delivery.value.ownerMatrixId !== options.settings.owner
      || delivery.value.matrixUserId !== options.matrixUserId || delivery.value.status !== 'active' || delivery.value.ownerStatus !== 'active') return failure('forbidden', 'Agent and owner must be active');
    if (delivery.value.ownerConversation === null) return success(undefined);
    const grant = delivery.value.roomGrants.find(grant => grant.roomId === delivery.value.ownerConversation);
    if (!grant || grant.muted || grant.accessMode === 'read') return failure('forbidden', 'Owner conversation requires unmuted read and reply access');
    let value: unknown;
    try { value = await options.client.get<unknown>(API + '/rooms/' + segment(delivery.value.ownerConversation) + '/state'); }
    catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Native owner conversation is unavailable'); }
    const state = roomState(value);
    if (!state.ok) return state;
    const privateRoom = ownerConversationState(state.value, options.settings.owner, options.matrixUserId);
    if (!privateRoom.ok) return privateRoom;
    if ([options.settings.owner, options.matrixUserId].some(identity => !state.value.some(event => event.type === 'm.room.member'
      && event.state_key === identity && event.content.membership === 'join'))) return failure('forbidden', 'Both participants must have joined the owner conversation');
    const powers = roomPowers(state.value.find(event => event.type === 'm.room.power_levels')?.content ?? {}, options.matrixUserId);
    return powers.ok && powers.value.ownerLevel >= powers.value.message ? success(undefined) : failure('forbidden', 'Agent cannot send the decision to its owner');
  }
  async function request(decision: RuntimeDecision, cancelled: AbortSignal): Promise<Result<Json>> {
    const signal = AbortSignal.any([stop, cancelled, ...(decision.expiresMs == null ? [] : [options.clock.deadline(decision.expiresMs)])]);
    const identity = key(decision);
    if (pending.has(identity)) return failure('conflict', 'The native request is already pending');
    if (!decision.turn || !decision.item) return failure('invalid', 'Native decisions require original turn and item identities');
    pending.add(identity);
    const receipt = { id: randomUUID(), native: identity, status: 'pending' as 'pending' | 'responded' | 'cancelled' };
    let offered = false;
    try {
      signal.throwIfAborted();
      const runId = await options.run();
      start();
      receipts.push(receipt); save();
      const questions = decision.questions ?? [{ id: 'decision', title: decision.action, prompt: 'Review the complete native scope before selecting a choice.',
        secret: false, allowText: false, options: decision.choices.map((choice, index) => ({ id: String(index), label: choice.label, description: '' })) }];
      const created = await options.coordination.createDecision(options.agent, { id: receipt.id, runId, runtime: decision.runtime, sessionId: decision.session,
        requestId: decision.request, turnId: decision.turn, itemId: decision.item, kind: decision.questions ? 'question' : 'permission',
        action: decision.action, review: JSON.stringify(decision.scope, null, 2), blocking: decision.blocking ?? true,
        expiresAt: decision.expiresMs == null ? null : options.clock.now() + decision.expiresMs, questions }, signal);
      if (!created.ok) return created;
      const room = await options.coordination.ownerConversation(options.agent, signal);
      if (!room.ok) return room;
      const authorized = await authorize();
      if (!authorized.ok) return authorized;
      const base = options.coordination.origin + '/manage/agents/' + options.agent + '/decisions/' + receipt.id;
      const links = questions.length === 1 ? questions[0]!.options.map(option => option.label + ': ' + base + '?choice=' + encodeURIComponent(option.id)).join('\n') : '';
      const prompts = questions.map(question => question.title + ': ' + question.prompt).join('\n\n');
      const notices = ownerNoticeChunks(decision.action + ': review and answer at ' + base + '.'
          + '\n\n' + prompts
          + (links ? '\n\n' + links : '') + '\n\nLinks only open a review. Submit explicitly. '
          + (decision.blocking ? 'The native request is waiting.' : 'This request is nonblocking and may expire.'));
      for (const [position, text] of notices.entries()) await options.client.put(API + '/rooms/' + segment(room.value.roomId) + '/send/m.room.message/' + receipt.id + '-' + position, ownerNotice(text));
      for (;;) {
        signal.throwIfAborted();
        const answer = await options.coordination.pollDecision(options.agent, receipt.id, signal);
        if (!answer.ok) return answer;
        if (answer.value.status === 'answered') {
          signal.throwIfAborted();
          const authorized = await authorize();
          if (!authorized.ok) return authorized;
          if (!decision.questions) {
            const selected = answer.value.answers[0];
            const choice = selected?.optionId == null ? undefined : decision.choices[Number(selected.optionId)];
            if (!choice) return failure('invalid', 'Native choice is unavailable');
            offered = true; return success(structuredClone(choice.value));
          }
          const answers: Record<string, Json> = {};
          for (const question of questions) {
            const answerRow = answer.value.answers.find(answer => answer.questionId === question.id);
            const value = answerRow?.text ?? question.options.find(option => option.id === answerRow?.optionId)?.label;
            if (value === undefined) return failure('invalid', 'Incomplete native answer');
            answers[question.id] = { answers: [value] };
          }
          offered = true; return success({ answers });
        }
        if (answer.value.status !== 'pending') return failure('conflict', 'Original native request is no longer pending');
        await options.clock.delay(1000, signal);
      }
    } catch (error) { return failure('unavailable', error instanceof Error ? error.message : 'Native decision transport unavailable'); }
    finally {
      pending.delete(identity);
      if (!offered && receipts.includes(receipt)) { receipt.status = 'cancelled'; save(); }
    }
  }
  return { authorize, request, start, unresolved,
    responded(decision: RuntimeDecision): void {
      const receipt = receipts.find(receipt => receipt.native === key(decision) && receipt.status === 'pending');
      if (receipt) { receipt.status = 'responded'; save(); }
    },
    async close(): Promise<void> {
      for (const receipt of receipts) if (receipt.status === 'pending') receipt.status = 'cancelled';
      save(); await running;
      await flush(options.clock.deadline(15000)).catch(() => undefined);
    },
  };
}
