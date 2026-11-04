import * as check from './schema/validation.js';
export const historyRequest = check.object({ kind: check.choice('unread', 'history'), room: check.optional(check.roomId),
  limit: check.integer(1, 100), outputBytes: check.integer(1024, 98304), direction: check.choice('b', 'f'),
  cursors: check.refine(check.object({ entries: check.list(check.object({ room: check.roomId, cursor: check.text(4096) }), 1000) }),
    value => new Set(value.entries.map(entry => entry.room)).size === value.entries.length, 'Duplicate room continuations') });
export type HistoryRequest = check.Parsed<typeof historyRequest>;
