import { createMessagingClient } from '@ctlflow/crossfire-adapter-matrix/messaging-client';
import { messageEvent } from '@ctlflow/crossfire-adapter-matrix/events';
import assert from 'node:assert/strict';
import test from 'node:test';
import { listenerMaintenance } from '@ctlflow/crossfire-agent-core/listener-maintenance';
import { eventView } from '@ctlflow/crossfire-agent-core/receive';
import type { LocalState } from '@ctlflow/crossfire-agent-core/port';
import { localState } from '@ctlflow/crossfire-adapter-filesystem/state';
import { matrix as nativeMatrix } from '@ctlflow/crossfire-adapter-matrix/http';
import { listen } from '@ctlflow/crossfire-agent-core/listen';
import type { RuntimeAdapter } from '@ctlflow/crossfire-agent-core/runtime';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { testClock } from '../scripts/test-support/clock.js';
import { matrixFixture, message, mention, ROOM, THREAD, temporary, until } from '../scripts/test-support/listener.js';

test('ordinary blocked-mention notices retain their exact identity across cancellation and restart', async scope => {
  const fixture = await matrixFixture(scope, temporary(scope)), clock = testClock(scope), values = new Map<string, unknown>();
  const storage: LocalState = { exists: file => values.has(file), read: <Value>(file: string) => structuredClone(values.get(file)) as Value,
    write: (file, value) => { values.set(file, structuredClone(value)); }, remove: file => { values.delete(file); } };
  const preemption = new AbortController(); let release!: () => void;
  const entered = new Promise<void>(resolve => { release = resolve; });
  const options = { clock, interval: 30000, storage, file: 'maintenance', agentId: fixture.id, invitationRooms: async () => [] as string[],
    coordination: { ...fixture.coordination, notice: async (...parameters: Parameters<typeof fixture.coordination.notice>) => {
      const signal = parameters[3]; assert(signal); release();
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return fixture.coordination.notice(...parameters);
    } } };
  const maintenance = listenerMaintenance(options), event = eventView(messageEvent(message('$blocked-notice'), ROOM), ROOM);
  maintenance.notice(event); maintenance.notice(event);
  assert.equal(storage.read<unknown[]>('maintenance').length, 1);
  const publishing = maintenance.publish(preemption.signal), rejected = assert.rejects(publishing, /Steering preemption/u);
  await entered; preemption.abort(new Error('Steering preemption')); await rejected;
  const restarted = listenerMaintenance({ ...options, coordination: fixture.coordination });
  assert(restarted.pending()); await restarted.publish(new AbortController().signal);
  assert(!storage.exists('maintenance')); assert(!restarted.pending());
  const notices = fixture.requests.filter(request => request.path.endsWith('/wake-notices/' + event.eventId));
  assert.equal(notices.length, 1); assert.deepEqual(notices[0]!.body, { roomId: ROOM });
});

test('a hung invitation lookup cannot hold the Matrix watch or accepted steering input', { timeout: 10000 }, async scope => {
  const clock = testClock(scope), matrix = await matrixFixture(scope, temporary(scope), clock), stop = new AbortController();
  const delivered: string[] = []; let maintenanceStarted = false, cancelled = false, failure: unknown;
  const runtime: RuntimeAdapter = async signal => ({ sessionId: THREAD, signal, approval: 'none',
    inspect: async () => ({ busy: false }), close: () => {}, acknowledge: () => {}, recover: async () => false, settle: async () => false,
    turnControl: { activeTurn: async () => null, interrupt: async () => 'inactive' }, deliver: async text => { delivered.push(text); } });
  const receiving = listen({ ...matrix, clock, storage: localState,
    transport: signal => createMessagingClient(nativeMatrix({ base: matrix.settings.server, token: matrix.account.accessToken, signal }), matrix.account.userId),
    invitationRooms: async signal => {
      maintenanceStarted = true;
      return new Promise<readonly string[]>((_resolve, reject) => {
        if (signal.aborted) { cancelled = true; reject(signal.reason); return; }
        signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason); }, { once: true });
      });
    }, runtime, limit: 20, pollMs: 10000, reconcileMs: 30000, debounceMs: 1000 }, stop.signal)
    .catch(error => { if (!stop.signal.aborted) failure = error; });
  cleanup(scope, async () => { stop.abort(); await receiving; });
  await until(() => { if (failure) throw failure; return maintenanceStarted && matrix.waiting() === 1; });
  matrix.add(ROOM, mention('$priority-over-maintenance'));
  await until(() => { if (failure) throw failure; return delivered.some(text => text.includes('$priority-over-maintenance')); });
  assert(cancelled); assert.equal(clock.now(), 0); assert.equal(delivered.length, 1);
});
