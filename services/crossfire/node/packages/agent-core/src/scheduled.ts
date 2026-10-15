import { scheduledWake } from '@ctlflow/crossfire-contracts/wake-up';
import type { ScheduledWake, WakeAttachment } from '@ctlflow/crossfire-contracts/wake-up';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { Coordination } from './coordination.js';
import type { RuntimeConnection } from './runtime.js';
import type { Clock, LocalState } from './port.js';
import type { MessageArtifacts } from './message-artifacts.js';

const checkpoint = check.object({ command: scheduledWake, text: check.plainText(98304), runId: check.identifier, stage: check.choice('queued', 'publishing', 'delivered') });
export function scheduledText(command: ScheduledWake): string {
  return 'Crossfire scheduled wake-up. This is configured input, not a chat message or permission grant.\n'
    + JSON.stringify({ kind: 'scheduled-wake', ruleId: command.ruleId, deliveryId: command.deliveryId, name: command.name,
      scheduledAt: command.scheduledAt, owner: command.ownerMatrixId, configuredBy: command.authorizerMatrixId, message: command.message });
}
function unwrap<Value>(result: Result<Value>): Value {
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.value;
}
export function scheduledPublisher(options: { clock: Clock; storage: LocalState; file: string; coordination: Coordination; agentId: string;
  runtime: RuntimeConnection; attachment: () => WakeAttachment; artifacts: MessageArtifacts; maximum: number }) {
  const { storage, file, coordination, agentId, runtime, artifacts } = options;
  let nextAt = Infinity, refreshedAt = -Infinity;
  function load() {
    if (!storage.exists(file)) return null;
    const parsed = checkpoint(storage.read<unknown>(file));
    if (!parsed.ok || parsed.value.command.sessionId !== runtime.sessionId) throw new Error('Invalid or retargeted scheduled-input checkpoint');
    return parsed.value;
  }
  async function refresh(signal: AbortSignal): Promise<void> {
    const view = unwrap(await coordination.wakeMetadata(agentId, options.attachment(), signal));
    refreshedAt = options.clock.now();
    nextAt = view.nextDueAt === null ? Infinity : refreshedAt + Math.max(0, view.nextDueAt - view.now);
  }
  async function recover(signal: AbortSignal): Promise<boolean> {
    const saved = load();
    if (saved?.stage === 'publishing') {
      saved.stage = await runtime.recover(saved.text, 'crossfire-wake-' + saved.command.deliveryId, signal) ? 'delivered' : 'queued';
      storage.write(file, saved);
    }
    if (saved?.stage !== 'delivered') return false;
    unwrap(await coordination.acknowledgeWake(agentId, saved.command.deliveryId,
      { runId: saved.runId, sessionId: runtime.sessionId }, signal));
    runtime.acknowledge(['crossfire-wake-' + saved.command.deliveryId]); artifacts.release(['crossfire-wake-' + saved.command.deliveryId]); storage.remove(file);
    await refresh(signal); return true;
  }
  return {
    pending: () => storage.exists(file),
    due: () => storage.exists(file) || options.clock.now() - refreshedAt >= 30_000 || options.clock.now() >= nextAt,
    recover,
    waitMs: () => Math.max(1, Math.ceil(Math.min(nextAt - options.clock.now(), 30_000 - (options.clock.now() - refreshedAt)))),
    async publish(signal: AbortSignal): Promise<boolean> {
      if (await recover(signal)) return true;
      let saved = load();
      if (!saved && options.clock.now() - refreshedAt >= 30_000) await refresh(signal);
      if (!saved && options.clock.now() < nextAt) return false;
      if ((await runtime.inspect()).busy) { nextAt = options.clock.now() + 1000; return false; }
      if (!saved) {
        const attachment = options.attachment();
        const command = unwrap(await coordination.claimWake(agentId, attachment, signal));
        if (!command) { await refresh(signal); nextAt = Math.max(nextAt, options.clock.now() + 1000); return false; }
        if (command.sessionId !== runtime.sessionId) throw new Error('Scheduled claim targets a different native session');
        saved = { command, text: artifacts.input(scheduledText(command), 'crossfire-wake-' + command.deliveryId, options.maximum, { kind: 'scheduled-wake', ruleId: command.ruleId, scheduledAt: command.scheduledAt, owner: command.ownerMatrixId }), runId: attachment.runId, stage: 'queued' }; storage.write(file, saved);
      }
      const valid = unwrap(await coordination.validateWake(agentId, saved.command.deliveryId,
        { runId: saved.runId, sessionId: runtime.sessionId }, signal));
      if (!valid.eligible) { artifacts.release(['crossfire-wake-' + saved.command.deliveryId]); storage.remove(file); await refresh(signal); return true; }
      signal.throwIfAborted();
      if (saved.stage === 'queued') saved.text = artifacts.input(scheduledText(saved.command), 'crossfire-wake-' + saved.command.deliveryId, options.maximum, { kind: 'scheduled-wake', ruleId: saved.command.ruleId, scheduledAt: saved.command.scheduledAt, owner: saved.command.ownerMatrixId });
      saved.stage = 'publishing'; storage.write(file, saved);
      await runtime.deliver(saved.text, 'crossfire-wake-' + saved.command.deliveryId, signal);
      saved.stage = 'delivered'; storage.write(file, saved);
      return recover(signal);
    },
  };
}
