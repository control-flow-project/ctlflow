import type { MessagingInspection } from '@ctlflow/crossfire-domain/port/messaging-inspection';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { nativeJson, type Native } from './http.js';
import { API } from './protocol.js';
import { userId, roomId } from './syntax.js';

export function matrixInspection(native: Native & { token: string }): MessagingInspection {
  return {
    async verifyProfile(user, displayName) {
      if (!userId(user)) return failure('invalid', 'Invalid Matrix profile identity');
      const found = await nativeJson(native, 'POST', API + '/user_directory/search', { search_term: user, limit: 100 });
      if (!found.ok) return found;
      const body = found.value.body;
      return found.value.status === 200 && body && typeof body === 'object' && !Array.isArray(body) && Array.isArray(body.results)
        && body.results.some(item => item && typeof item === 'object' && !Array.isArray(item) && item.user_id === user && item.display_name === displayName)
        ? success(undefined) : failure('native', 'Agent is absent or incorrectly named in the native invitation directory');
    },
    async joinedRooms() {
      const joined = await nativeJson(native, 'GET', API + '/joined_rooms');
      if (!joined.ok) return joined;
      const body = joined.value.body;
      return joined.value.status === 200 && body && typeof body === 'object' && !Array.isArray(body)
        && Array.isArray(body.joined_rooms) && body.joined_rooms.every(roomId)
        ? success(body.joined_rooms as string[]) : failure('native', 'Invalid Matrix joined-room response');
    },
    async close() {
      const ended = await nativeJson({ base: native.base, token: native.token, timeoutMs: 15000 }, 'POST', API + '/logout', {});
      return ended.ok && ended.value.status === 200 ? success(undefined) : failure('unavailable', 'Native verification session logout failed');
    },
  };
}
