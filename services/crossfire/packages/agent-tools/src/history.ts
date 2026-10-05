import { historyRequest } from '@ctlflow/crossfire-agent-core/history-query';
import { listenerRequest } from '@ctlflow/crossfire-adapter-crossfire/listener-client';
import { integerOption } from '@ctlflow/crossfire-contracts/limits';
import { option, type Arguments } from '@ctlflow/crossfire-adapter-matrix/commands';
import type { paths } from '@ctlflow/crossfire-adapter-filesystem/project';
import { emitText } from './output.js';

export async function readHistory(destination: ReturnType<typeof paths>, command: 'read' | 'history', values: Arguments, maximum: number): Promise<void> {
  const room = option(values, 'room'), continuation = option(values, 'continuation');
  const request = historyRequest({ kind: command === 'read' ? 'unread' : 'history', ...(room ? { room } : {}),
    limit: integerOption(option(values, 'limit'), 100, 1, 100, '--limit'), outputBytes: maximum, direction: option(values, 'direction') ?? 'b',
    cursors: continuation ? JSON.parse(continuation) as unknown : { entries: [] } });
  if (!request.ok) throw new Error(request.error.message);
  const response = await listenerRequest(destination.state, { action: 'read', input: request.value });
  if (!response) throw new Error('The owning controller receiver is unavailable. No replacement receiver was started and unread positions were preserved.');
  if (!response.ok) throw new Error(response.error.code + ': ' + response.error.message);
  emitText(response.value.text, maximum);
  if (response.value.queryId) {
    const acknowledged = await listenerRequest(destination.state, { action: 'acknowledge', queryId: response.value.queryId });
    if (!acknowledged?.ok) throw new Error(acknowledged && !acknowledged.ok ? acknowledged.error.message : 'Controller receiver stopped before acknowledging catch-up; positions were preserved');
  }
}
