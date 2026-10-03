import type { Matrix } from './port.js';
import type { Event } from '@crossfire/contracts/client';
import { API, segment } from '@crossfire/contracts/matrix';

export const HISTORY_RESOURCE_BYTES = 64 * 1024 * 1024;
export type HistoryPage = { chunk: Event[]; start?: string; end?: string };
export function responseOverflow(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'body_too_large';
}
export async function historyPage(client: Matrix, room: string, query: Record<string, string | number> & { limit: number }): Promise<HistoryPage & { requestedLimit: number }> {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error('Invalid native history page limit');
  let limit = query.limit;
  for (;;) {
    try {
      const page = await client.get<HistoryPage>(`${API}/rooms/${segment(room)}/messages`, { ...query, limit }, limit === 1 ? HISTORY_RESOURCE_BYTES : undefined);
      return { ...page, requestedLimit: limit };
    } catch (error) {
      if (!responseOverflow(error)) throw error;
      if (limit === 1) throw Object.assign(new Error('A single native history event exceeds the 64 MiB collection resource bound; unread positions are unchanged'), { code: 'limit' });
      limit = Math.max(1, Math.floor(limit / 2));
    }
  }
}
