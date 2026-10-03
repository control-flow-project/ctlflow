import type { LocalState } from './port.js';
import type { RuntimeConnection } from './runtime.js';
import type { ReadBatch, ReceivedEvent } from './receive.js';
import { validReadBatch } from './receive.js';
import { chatBatches } from './chat-batches.js';
import type { Settings } from '@crossfire/contracts/client';
import type { PrincipalIdentity } from '@crossfire/contracts/schema/response';
import { principalIdentity } from '@crossfire/contracts/schema/response';
import * as check from '@crossfire/contracts/schema/validation';
import { json } from '@crossfire/contracts/matrix';
import type { MessageArtifacts } from './message-artifacts.js';

type Step = { indices: number[]; text: string; id: string; room: string | null; session: string | null; status: 'prepared' | 'publishing' | 'delivered' };
type Plan = { mode: 'shared' | 'per-room'; batch: ReadBatch; identities: PrincipalIdentity[]; steps: Step[] };
function validPlan(value: unknown, mode: Plan['mode'], maximum: number): value is Plan {
  if (!json(value) || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as Partial<Plan>;
  return plan.mode === mode && validReadBatch(plan.batch)
    && Array.isArray(plan.identities) && plan.identities.every(identity => principalIdentity(identity).ok)
    && Array.isArray(plan.steps) && plan.steps.every(step => !!step && Array.isArray(step.indices) && step.indices.length > 0
      && new Set(step.indices).size === step.indices.length && step.indices.every(index => Number.isSafeInteger(index) && index >= 0 && index < plan.batch!.events.length)
      && typeof step.text === 'string' && Buffer.byteLength(step.text) <= maximum && check.text(200)(step.id).ok
      && ['prepared', 'publishing', 'delivered'].includes(step.status) && check.nullable(check.roomId)(step.room).ok
      && check.nullable(check.text(255))(step.session).ok && (step.status === 'prepared' || step.session !== null));
}
export function chatPublication(options: { storage: LocalState; file: string; settings: Settings; runtime: RuntimeConnection;
  mode: 'shared' | 'per-room'; maximum: number; artifacts: MessageArtifacts; delivered: (room: string, session: string) => Promise<void>; count: (messages: number) => void; traffic: (events: readonly ReceivedEvent[]) => void }) {
  const bytes = 128 * 1024 * 1024;
  if (!Number.isSafeInteger(options.maximum) || options.maximum < 1024 || options.maximum > 4194304) throw new Error('Invalid chat input limit');
  const loaded = options.storage.exists(options.file) ? options.storage.read<unknown>(options.file, bytes) : undefined;
  if (loaded !== undefined && !validPlan(loaded, options.mode, 4194304)) throw new Error('Invalid pending chat publication or changed history configuration');
  let plan = loaded as Plan | undefined;
  const save = () => options.storage.write(options.file, plan, bytes);
  const outcome = (allowed: ReadonlySet<string>) => plan && !plan.steps.some(step => step.status !== 'delivered') ? {
    batch: { ...plan.batch, cursors: Object.fromEntries(Object.entries(plan.batch.cursors).filter(([room]) => allowed.has(room))),
      latest: Object.fromEntries(Object.entries(plan.batch.latest).filter(([room]) => allowed.has(room))), more_rooms: plan.batch.more_rooms.filter(room => allowed.has(room)) },
    messageIds: plan.steps.map(step => step.id),
  } : undefined;
  const identity = (event: ReceivedEvent) => JSON.stringify([event.room_id, event.event_id]);
  function steps(events: ReceivedEvent[], identities: PrincipalIdentity[], records: ReceivedEvent[]): Step[] {
    const directory = new Map(identities.map(identity => [identity.matrixUserId, identity]));
    const positions = new Map(records.map((event, index) => [identity(event), index]));
    return chatBatches(events, options.settings, directory, options.maximum, options.mode, options.artifacts)
      .map(batch => ({ indices: batch.events.map(event => { const index = positions.get(identity(event)); if (index === undefined) throw new Error('Publication event is outside its acquisition'); return index; }),
        text: batch.text, id: batch.messageId, room: batch.room, session: null, status: 'prepared' }));
  }
  const stepEvents = (step: Step) => step.indices.map(index => plan!.batch.events[index]!);
  function replace(index: number, step: Step, events: ReceivedEvent[]) {
    const replacement = steps(events, plan!.identities, plan!.batch.events);
    plan!.steps.splice(index, 1, ...replacement); save();
    if (!replacement.some(next => next.id === step.id)) options.artifacts.release([step.id]);
  }
  return {
    pending: () => plan !== undefined,
    contentFiles: () => plan?.batch.events.flatMap(event => event.content_file ? [event.content_file.file] : []) ?? [],
    prepare(batch: ReadBatch, events: ReceivedEvent[], identities: ReadonlyMap<string, PrincipalIdentity>) {
      if (plan) throw new Error('Settle the original chat publication before preparing another');
      const enriched = new Map(events.map(event => [identity(event), event]));
      const records = batch.events.map(event => enriched.get(identity(event)) ?? event);
      plan = { mode: options.mode, batch: { ...batch, events: records }, identities: [...identities.values()], steps: steps(events, [...identities.values()], records) }; save();
    },
    async recover(allowed: ReadonlySet<string>) {
      if (!plan) return undefined;
      for (const step of plan.steps) if (step.status === 'publishing') {
        const target = step.room ? await options.runtime.conversation?.(step.room) : options.runtime;
        if (!target || target.sessionId !== step.session) throw new Error('Original pending history is unavailable');
        const received = await target.recover(step.text, step.id);
        step.status = received ? 'delivered' : 'prepared'; save();
        if (received) { const events = stepEvents(step); options.count(events.filter(event => event.type === 'm.room.message').length); options.traffic(events); }
      }
      return outcome(allowed);
    },
    async publish(allowed: ReadonlySet<string>, signal: AbortSignal): Promise<{ batch: ReadBatch; messageIds: string[] } | undefined> {
      if (!plan) return undefined;
      for (let index = 0; index < plan.steps.length; index++) {
        const step = plan.steps[index]!;
        if (step.status === 'delivered') continue;
        signal.throwIfAborted();
        const events = stepEvents(step);
        if (step.status === 'prepared') {
          const remaining = events.filter(event => allowed.has(event.room_id));
          if (remaining.length !== events.length) {
            replace(index, step, remaining); index--; continue;
          }
          if (Buffer.byteLength(step.text) > options.maximum) { replace(index, step, remaining); index--; continue; }
        }
        const target = step.room ? await options.runtime.conversation?.(step.room) : options.runtime;
        if (!target) throw new Error('Selected native runtime cannot own room histories');
        if (step.session !== null && step.session !== target.sessionId) throw new Error('Pending input belongs to another native history; it was not retargeted');
        if (step.status === 'publishing' && await target.recover(step.text, step.id)) {
          step.status = 'delivered'; save(); options.count(events.filter(event => event.type === 'm.room.message').length); options.traffic(events); continue;
        }
        const remaining = events.filter(event => allowed.has(event.room_id));
        if (remaining.length !== events.length) {
          replace(index, step, remaining); index--; continue;
        }
        step.session = target.sessionId; step.status = 'publishing'; save();
        await target.deliver(step.text, step.id, signal);
        step.status = 'delivered'; save(); options.count(events.filter(event => event.type === 'm.room.message').length);
        options.traffic(events);
        const room = events.findLast(event => event.type === 'm.room.message')?.room_id;
        if (room) await options.delivered(room, target.sessionId);
      }
      return outcome(allowed);
    },
    acknowledge() { if (plan?.steps.some(step => step.status !== 'delivered')) throw new Error('Cannot discard unconfirmed chat input');
      if (plan) options.artifacts.release(plan.steps.map(step => step.id));
      plan = undefined; if (options.storage.exists(options.file)) options.storage.remove(options.file); },
  };
}
