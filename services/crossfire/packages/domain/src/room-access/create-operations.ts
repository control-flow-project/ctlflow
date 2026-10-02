import type { RoomOperations } from '../port/room-operations.js';

export function createRoomOperations(): RoomOperations {
  const pending = new Map<string, Promise<void>>();
  return {
    async run(roomId, operation) {
      const previous = pending.get(roomId) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>(resolve => { release = resolve; });
      pending.set(roomId, current);
      await previous;
      try { return await operation(); }
      finally {
        release();
        if (pending.get(roomId) === current) pending.delete(roomId);
      }
    },
  };
}
