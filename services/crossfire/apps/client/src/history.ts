import { historyRequest, historyQueries } from '@crossfire/agent-core/history-query';
import { messageArtifacts } from '@crossfire/agent-core/message-artifacts';
import { localState } from '@crossfire/adapter-filesystem/state';
import { acquireProcessLock } from '@crossfire/adapter-filesystem/lock';
import { listenerRequest } from '@crossfire/adapter-crossfire/listener-client';
import { createCoordination } from '@crossfire/adapter-crossfire/coordination';
import { matrix } from '@crossfire/adapter-matrix/http';
import { synchronize, loadSyncCursor, checkpointSync, membershipResets, retainJoinedCursors, flushAcknowledgements, joinedRooms } from '@crossfire/agent-core/receive';
import { join } from 'node:path';
import { integerOption } from '@crossfire/contracts/limits';
import { option, type Arguments } from '@crossfire/adapter-matrix/commands';
import type { readProfile, paths } from '@crossfire/adapter-filesystem/project';
import { emitText } from './output.js';

export async function readHistory(destination: ReturnType<typeof paths>, profile: ReturnType<typeof readProfile>, command: 'read' | 'history', values: Arguments, maximum: number) {
  const room = option(values, 'room'), continuation = option(values, 'continuation');
  const request = historyRequest({ kind: command === 'read' ? 'unread' : 'history', ...(room ? { room } : {}),
    limit: integerOption(option(values, 'limit'), 100, 1, 100, '--limit'), outputBytes: maximum, direction: option(values, 'direction') ?? 'b',
    cursors: continuation ? JSON.parse(continuation) as unknown : { entries: [] } });
  if (!request.ok) throw new Error(request.error.message);
  const live = await listenerRequest(destination.state, { action: 'read', input: request.value });
  if (live) {
    if (!live.ok) throw new Error(live.error.code + ': ' + live.error.message);
    emitText(live.value.text!, maximum);
    if (live.value.queryId) {
      const acknowledged = await listenerRequest(destination.state, { action: 'acknowledge', queryId: live.value.queryId });
      if (!acknowledged?.ok) throw new Error(acknowledged && !acknowledged.ok ? acknowledged.error.message : 'Receiver stopped before acknowledging catch-up; positions were preserved');
    }
    return;
  }
  const unlock = await acquireProcessLock(join(destination.state, 'receiver'));
  try {
    const transport = matrix({ base: profile.settings.homeserver, token: profile.account.access_token });
    const coordination = createCoordination({ origin: profile.settings.homeserver, token: profile.account.access_token });
    if (command === 'read') {
      await flushAcknowledgements(localState, transport, destination.cursors);
      const since = loadSyncCursor(localState, destination.cursors), synced = await synchronize(transport, since);
      const resets = await membershipResets(transport, synced, profile.account, since);
      retainJoinedCursors(localState, destination.cursors, new Set((await joinedRooms(transport)).filter(room => !resets.has(room))));
      checkpointSync(localState, destination.cursors, synced.next_batch);
    }
    const queries = historyQueries({ storage: localState, file: destination.cursors, matrix: transport, coordination,
      account: profile.account, settings: profile.settings, agentId: profile.id, now: Date.now,
      artifacts: messageArtifacts(localState, destination.cursors + '.messages', Date.now),
      publishing: () => localState.exists(destination.cursors + '.chat-publication') });
    const recovered = await queries.recover();
    if (!recovered.ok) throw new Error(recovered.error.code + ': ' + recovered.error.message);
    const result = await queries.read(request.value);
    if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message);
    emitText(result.value.text, maximum);
    if (result.value.queryId) { const acknowledged = await queries.acknowledge(result.value.queryId); if (!acknowledged.ok) throw new Error(acknowledged.error.message); }
  } finally { await unlock(); }
}
