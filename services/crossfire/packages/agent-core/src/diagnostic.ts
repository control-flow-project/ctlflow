import type { Coordination } from './coordination.js';
import type { RuntimeConnection } from './runtime.js';
import type { Matrix } from './port.js';
import { API } from '@crossfire/contracts/matrix';
import type { WakePolicy } from '@crossfire/contracts/wake';
export type ListenerTest = { session: string; server: string; authenticated: true; rooms: number; joinedRooms: number;
  canReceiveRoomTasks: boolean; wakeMode: WakePolicy; busy: boolean; deliveryPaused: boolean; currentRelease: string; message: string };
export async function testListener(options: { coordination: Coordination; runtime: RuntimeConnection; matrix: Matrix; id: string;
  owner: string; matrixUserId: string; paused: boolean; signal: AbortSignal }): Promise<ListenerTest> {
  options.signal.throwIfAborted();
  const native = await options.runtime.inspect();
  const policy = await options.coordination.delivery(options.id, options.signal);
  if (!policy.ok) throw new Error(policy.error.message);
  if (policy.value.agentId !== options.id || policy.value.ownerMatrixId !== options.owner || policy.value.matrixUserId !== options.matrixUserId
    || policy.value.status !== 'active' || policy.value.ownerStatus !== 'active') throw new Error('Agent or owner access is inactive');
  const who = await options.matrix.get<{ user_id: string }>(API + '/account/whoami');
  if (who.user_id !== options.matrixUserId) throw new Error('Matrix authentication does not match this agent');
  const joined = await options.matrix.get<{ joined_rooms: string[] }>(API + '/joined_rooms');
  if (!Array.isArray(joined.joined_rooms) || joined.joined_rooms.some(room => typeof room !== 'string')) throw new Error('Invalid Matrix room response');
  const rooms = policy.value.roomGrants.filter(grant => !grant.muted);
  const waking = policy.value.senderMatrixIds.length > 0;
  if (rooms.some(grant => !joined.joined_rooms.includes(grant.roomId))) throw new Error('Granted room access is not applied yet; refresh room access in management and test again');
  const release = await options.coordination.release(options.signal);
  if (!release.ok) throw new Error(release.error.message);
  options.signal.throwIfAborted();
  return { session: options.runtime.sessionId, server: options.coordination.origin, authenticated: true, rooms: rooms.length,
    joinedRooms: joined.joined_rooms.length, canReceiveRoomTasks: rooms.length > 0 && !options.paused && waking, wakeMode: policy.value.wakeMode,
    busy: native.busy, deliveryPaused: options.paused, currentRelease: release.value.release,
    message: options.paused ? 'Listener is connected; delivery is paused.' : !rooms.length ? 'Listener is ready. No unmuted rooms are granted; the owner can assign access in management.'
      : !waking ? 'Listener is connected. Wake-up rules disable chat-triggered input; use the runtime directly or change the policy in management.' : 'Listener, exact runtime session, server authentication and room access are ready.' };
}
