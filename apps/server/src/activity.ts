import { fields, revision } from '../../../packages/contracts/src/management.js';
import { LISTENER_EXPIRY_MS, type ActivityView } from '../../../packages/contracts/src/activity.js';
import { failure, success, type Result } from '../../../packages/contracts/src/result.js';
import { type Context, type Human, record, agentRecord } from './context.js';
import * as queries from './data/queries.js';
import * as listeners from './data/listeners.js';
import { releaseName, updateNotice, type Manifest } from '../../../packages/contracts/src/release.js';

export function activity(ctx: Context, agent: string): ActivityView {
  const identity = queries.agent(ctx.store, agent);
  const owner = identity ? queries.member(ctx.store, identity.owner) : null;
  const current = identity?.status === 'active' && owner?.status === 'active'
    ? listeners.liveListeners(ctx.store, agent, ctx.now() - LISTENER_EXPIRY_MS) : [];
  return { ...listeners.listenerTotals(ctx.store, agent), listeners: current.length,
    runs: current.map(run => ({ id: run.id, release: run.release, started: run.started, lastSeen: run.lastSeen, disconnectRequested: run.disconnect === 1 })),
    status: current.length === 0 ? 'offline' : current.every(run => run.disconnect === 1) ? 'disconnecting' : 'online' };
}

export function heartbeat(ctx: Context, agent: string, input: unknown, current: Manifest): Result<{ disconnect: boolean; current: Manifest }> {
  if (input && typeof input === 'object' && !('release' in input)) return failure('conflict', updateNotice(ctx.config.publicOrigin, null, current));
  const parsed = fields(input, ['run', 'messages', 'stopped', 'release']);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  if (typeof data.run !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(data.run)
    || !revision(data.messages) || typeof data.stopped !== 'boolean' || !releaseName(data.release)) return failure('invalid', 'Invalid listener heartbeat');
  const { run, messages, stopped, release } = data;
  return ctx.store.transaction(() => {
    const identity = queries.agent(ctx.store, agent);
    if (!identity || !stopped && (identity.status !== 'active' || queries.member(ctx.store, identity.owner)?.status !== 'active')) {
      return failure('forbidden', 'Agent and owner must be active');
    }
    const now = ctx.now();
    const previous = listeners.listener(ctx.store, run);
    if (previous && previous.agent !== agent) return failure('missing', 'Listener not found');
    if (previous && previous.release !== release) return failure('conflict', 'A listener run cannot change release. Restart the listener with the current verified client and skills.');
    if (previous?.stopped) return success({ disconnect: true, current });
    if (!previous && release !== current.release) return failure('conflict', updateNotice(ctx.config.publicOrigin, release, current));
    const total = listeners.listenerTotals(ctx.store, agent).messages + Math.max(0, messages - (previous?.messages ?? 0));
    if (!Number.isSafeInteger(total)) return failure('limit', 'Reported message count exceeds the exact integer range');
    if (previous) {
      const elapsed = Math.max(0, now - previous.lastSeen);
      listeners.updateListener(ctx.store, { ...previous, lastSeen: now, stopped: stopped ? 1 : 0,
        activeMs: previous.activeMs + (elapsed <= LISTENER_EXPIRY_MS ? elapsed : 0), messages: Math.max(messages, previous.messages) });
    } else {
      if (listeners.liveListeners(ctx.store, agent, now - LISTENER_EXPIRY_MS).length >= 100) return failure('limit', 'Too many active listeners');
      listeners.insertListener(ctx.store, { id: run, agent, release, started: now, lastSeen: now, activeMs: 0, messages,
        stopped: stopped ? 1 : 0, disconnect: 0 });
    }
    return success({ disconnect: previous?.disconnect === 1, current });
  }).immediate();
}

export function disconnect(ctx: Context, human: Human, agent: string, input: unknown): Result<unknown> {
  const parsed = fields(input, []);
  if (!parsed.ok) return parsed;
  const found = agentRecord(ctx, human, agent);
  if (!found.ok) return found;
  const count = listeners.disconnectListeners(ctx.store, agent, ctx.now() - LISTENER_EXPIRY_MS);
  record(ctx, human.id, found.value.owner, agent, 'listener.disconnect', { count });
  return success(activity(ctx, agent));
}
