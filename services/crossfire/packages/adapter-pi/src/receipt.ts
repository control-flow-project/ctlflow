import { historySince, type HistoryBoundary } from '@ctlflow/crossfire-adapter-runtime/native-file';
import { record } from './protocol.js';
import { flushPiHistory } from './state.js';

export function piReceipt(file: string, boundary: HistoryBoundary, input: { text: string; messageId: string }, leaf: string | null): boolean {
  const parents = new Map<string, string | null>(), markers = new Set<string>(), users = new Set<string>();
  historySince(file, boundary, entry => {
    const value = record(entry);
    if (typeof value.id !== 'string' || value.parentId !== null && typeof value.parentId !== 'string') throw new Error('Invalid Pi native history tree entry');
    parents.set(value.id, value.parentId as string | null);
    if (value.type === 'custom' && value.customType === 'crossfire-input') {
      const data = record(value.data);
      if (data.messageId === input.messageId && data.text === input.text) markers.add(value.id);
    }
    if (value.type === 'message') {
      const message = record(value.message);
      if (message.role === 'user' && Array.isArray(message.content) && message.content.length === 1) {
        const content = record(message.content[0]);
        if (content.type === 'text' && content.text === input.text && typeof value.parentId === 'string' && markers.has(value.parentId)) users.add(value.id);
      }
    }
  });
  const visited = new Set<string>();
  for (let id = leaf; id !== null && parents.has(id); id = parents.get(id)!) {
    if (visited.has(id)) throw new Error('Pi native history contains a cycle');
    visited.add(id);
    if (users.has(id)) { flushPiHistory(file); return true; }
  }
  return false;
}
