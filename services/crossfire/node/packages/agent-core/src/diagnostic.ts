import type { Coordination } from './coordination.js';
import type { RuntimeConnection } from './runtime.js';
import type { MessagingClient } from './port.js';
import type { WakePolicy } from '@ctlflow/crossfire-contracts/wake';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { RuntimeApproval } from './runtime.js';
export type ListenerTest = { session: string; server: string; authenticated: true; rooms: number; joinedRooms: number;
  canReceiveRoomTasks: boolean; wakeMode: WakePolicy; busy: boolean; deliveryPaused: boolean; approval: RuntimeApproval; currentRelease: string; message: string };
export async function testListener(options: { coordination: Coordination; runtime: RuntimeConnection; messaging: MessagingClient; id: string;
  owner: string; backendUserId: string; paused: boolean; signal: AbortSignal; authorizeApproval?: () => Promise<Result<void>> }): Promise<ListenerTest> {
  options.signal.throwIfAborted();
  if (options.runtime.approval === 'listener' && !options.authorizeApproval) throw new Error('The verified owner DM approval broker is not connected');
  if (options.authorizeApproval) {
    const authorized = await options.authorizeApproval();
    if (!authorized.ok) throw new Error('Native approval setup is not ready: ' + authorized.error.message);
  }
  const native = await options.runtime.inspect();
  const policy = await options.coordination.delivery(options.id, options.signal);
  if (!policy.ok) throw new Error(policy.error.message);
  if (policy.value.agentId !== options.id || policy.value.ownerBackendUserId !== options.owner || policy.value.backendUserId !== options.backendUserId
    || policy.value.status !== 'active' || policy.value.ownerStatus !== 'active') throw new Error('Agent or owner access is inactive');
  const who = await options.messaging.identify();
  if (who !== options.backendUserId) throw new Error('Backend authentication does not match this agent');
  const joined = await options.messaging.joinedRooms();
  const rooms = policy.value.roomGrants.filter(grant => !grant.muted);
  const waking = policy.value.senderBackendUserIds.length > 0;
  if (rooms.some(grant => !joined.includes(grant.roomId))) throw new Error('Granted room access is not applied yet; refresh room access in management and test again');
  const release = await options.coordination.release(options.signal);
  if (!release.ok) throw new Error(release.error.message);
  options.signal.throwIfAborted();
  return { session: options.runtime.sessionId, server: options.coordination.origin, authenticated: true, rooms: rooms.length,
    joinedRooms: joined.length, canReceiveRoomTasks: rooms.length > 0 && !options.paused && waking, wakeMode: policy.value.wakeMode,
    busy: native.busy, deliveryPaused: options.paused, approval: options.runtime.approval, currentRelease: release.value.release,
    message: options.paused ? 'Listener is connected; delivery is paused.' : !rooms.length ? 'Listener is ready. No unmuted rooms are granted. The owner can open a DM or invite this agent through the chat backend; native approvals open the private DM only when needed.'
      : !waking ? 'Listener is connected. Wake-up rules disable chat-triggered input; use the runtime directly or change the policy in management.' : 'Listener, exact runtime session, server authentication and room access are ready.' };
}
