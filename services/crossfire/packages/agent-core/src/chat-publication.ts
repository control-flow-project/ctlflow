import type { LocalState } from './port.js';
import type { RuntimeConnection } from './runtime.js';
import type { ReadBatch, ReceivedEvent } from './receive.js';
import { chatBatches } from './chat-batches.js';
import type { Settings } from '@crossfire/contracts/client';
import type { PrincipalIdentity } from '@crossfire/contracts/schema/response';
import { principalIdentity } from '@crossfire/contracts/schema/response';
import * as check from '@crossfire/contracts/schema/validation';
import { json } from '@crossfire/contracts/matrix';

type Step = { events: ReceivedEvent[]; text: string; id: string; room: string | null; session: string | null; status: 'prepared' | 'publishing' | 'delivered' };
type Plan = { mode: 'shared' | 'per-room'; batch: ReadBatch; identities: PrincipalIdentity[]; steps: Step[] };
function validEvent(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<ReceivedEvent>;
  return check.roomId(event.room_id).ok && check.eventId(event.event_id).ok && check.matrixUserId(event.sender).ok
    && check.text(255)(event.type).ok && !!event.content && typeof event.content === 'object' && !Array.isArray(event.content)
    && !!event.origin && ['unknown', 'dm', 'room'].includes(event.origin.kind)
    && check.nullable(check.plainText(16000))(event.origin.name).ok && check.nullable(check.text(255))(event.origin.alias).ok
    && (event.timestamp === null || typeof event.timestamp === 'string' && Number.isFinite(Date.parse(event.timestamp)))
    && (event.state_key === undefined || typeof event.state_key === 'string')
    && (event.omitted === undefined || check.list(check.text(255), 100)(event.omitted).ok);
}
function validCursors(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([room, cursor]) => check.roomId(room).ok && check.text(4096)(cursor).ok);
}
function validPlan(value: unknown, mode: Plan['mode'], maximum: number): value is Plan {
  if (!json(value) || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as Partial<Plan>;
  return plan.mode === mode && !!plan.batch && Array.isArray(plan.batch.events) && plan.batch.events.every(validEvent)
    && validCursors(plan.batch.cursors) && validCursors(plan.batch.latest) && check.list(check.roomId, 2000)(plan.batch.more_rooms).ok
    && Array.isArray(plan.identities) && plan.identities.every(identity => principalIdentity(identity).ok)
    && Array.isArray(plan.steps) && plan.steps.every(step => !!step && Array.isArray(step.events) && step.events.length > 0 && step.events.every(validEvent)
      && typeof step.text === 'string' && Buffer.byteLength(step.text) <= maximum && check.text(200)(step.id).ok
      && ['prepared', 'publishing', 'delivered'].includes(step.status) && check.nullable(check.roomId)(step.room).ok
      && check.nullable(check.text(255))(step.session).ok && (step.status === 'prepared' || step.session !== null));
}
export function chatPublication(options: { storage: LocalState; file: string; settings: Settings; runtime: RuntimeConnection;
  mode: 'shared' | 'per-room'; maximum: number; delivered: (room: string, session: string) => Promise<void>; count: (messages: number) => void }) {
  const bytes = 32 * 1024 * 1024;
  const loaded = options.storage.exists(options.file) ? options.storage.read<unknown>(options.file, bytes) : undefined;
  if (loaded !== undefined && !validPlan(loaded, options.mode, options.maximum)) throw new Error('Invalid pending chat publication or changed history/input configuration');
  let plan = loaded as Plan | undefined;
  const save = () => options.storage.write(options.file, plan, bytes);
  const outcome = (allowed: ReadonlySet<string>) => plan && !plan.steps.some(step => step.status !== 'delivered') ? {
    batch: { ...plan.batch, cursors: Object.fromEntries(Object.entries(plan.batch.cursors).filter(([room]) => allowed.has(room))),
      latest: Object.fromEntries(Object.entries(plan.batch.latest).filter(([room]) => allowed.has(room))), more_rooms: plan.batch.more_rooms.filter(room => allowed.has(room)) },
    messageIds: plan.steps.map(step => step.id),
  } : undefined;
  function steps(events: ReceivedEvent[], identities: PrincipalIdentity[]): Step[] {
    const directory = new Map(identities.map(identity => [identity.matrixUserId, identity]));
    return chatBatches(events, options.settings, directory, options.maximum, options.mode)
      .map(batch => ({ events: batch.events, text: batch.text, id: batch.messageId, room: batch.room, session: null, status: 'prepared' }));
  }
  return {
    pending: () => plan !== undefined,
    prepare(batch: ReadBatch, events: ReceivedEvent[], identities: ReadonlyMap<string, PrincipalIdentity>) {
      if (plan) throw new Error('Settle the original chat publication before preparing another');
      plan = { mode: options.mode, batch, identities: [...identities.values()], steps: steps(events, [...identities.values()]) }; save();
    },
    async recover(allowed: ReadonlySet<string>) {
      if (!plan) return undefined;
      for (const step of plan.steps) if (step.status === 'publishing') {
        const target = step.room ? await options.runtime.conversation?.(step.room) : options.runtime;
        if (!target || target.sessionId !== step.session) throw new Error('Original pending history is unavailable');
        const received = await target.recover(step.text, step.id);
        step.status = received ? 'delivered' : 'prepared'; save();
        if (received) options.count(step.events.filter(event => event.type === 'm.room.message').length);
      }
      return outcome(allowed);
    },
    async publish(allowed: ReadonlySet<string>, signal: AbortSignal): Promise<{ batch: ReadBatch; messageIds: string[] } | undefined> {
      if (!plan) return undefined;
      for (let index = 0; index < plan.steps.length; index++) {
        const step = plan.steps[index]!;
        if (step.status === 'delivered') continue;
        signal.throwIfAborted();
        if (step.status === 'prepared') {
          const remaining = step.events.filter(event => allowed.has(event.room_id));
          if (remaining.length !== step.events.length) {
            plan.steps.splice(index, 1, ...steps(remaining, plan.identities)); save(); index--; continue;
          }
        }
        const target = step.room ? await options.runtime.conversation?.(step.room) : options.runtime;
        if (!target) throw new Error('Selected native runtime cannot own room histories');
        if (step.session !== null && step.session !== target.sessionId) throw new Error('Pending input belongs to another native history; it was not retargeted');
        if (step.status === 'publishing' && await target.recover(step.text, step.id)) {
          step.status = 'delivered'; save(); options.count(step.events.filter(event => event.type === 'm.room.message').length); continue;
        }
        const remaining = step.events.filter(event => allowed.has(event.room_id));
        if (remaining.length !== step.events.length) {
          const replacement = steps(remaining, plan.identities);
          plan.steps.splice(index, 1, ...replacement); save(); index--; continue;
        }
        step.session = target.sessionId; step.status = 'publishing'; save();
        await target.deliver(step.text, step.id, signal);
        step.status = 'delivered'; save(); options.count(step.events.filter(event => event.type === 'm.room.message').length);
        const room = step.events.findLast(event => event.type === 'm.room.message')?.room_id;
        if (room) await options.delivered(room, target.sessionId);
      }
      return outcome(allowed);
    },
    acknowledge() { if (plan?.steps.some(step => step.status !== 'delivered')) throw new Error('Cannot discard unconfirmed chat input'); plan = undefined; if (options.storage.exists(options.file)) options.storage.remove(options.file); },
  };
}
