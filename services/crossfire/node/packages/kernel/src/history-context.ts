import { opaqueIdentifier } from './identifier.js';

export const MAX_HISTORY_CONTEXT = 260;
export function roomContext(room: string): string { return 'room/' + room; }
export function contextRoom(context: string): string | null { return context.startsWith('room/') ? context.slice(5) : null; }
export function validHistoryContext(context: string): boolean {
  const room = contextRoom(context);
  return context === 'shared' || context === 'control' || room !== null && opaqueIdentifier(room);
}
