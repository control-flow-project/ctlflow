import type { JsonObject } from '@ctlflow/crossfire-kernel/json';

export type MatrixEvent = { event_id: string; sender: string; type: string; room_id?: string; state_key?: string;
  content: JsonObject; origin_server_ts?: number; unsigned?: JsonObject };
export type MatrixSync = { next_batch: string; rooms?: {
  invite?: Record<string, { invite_state: { events: MatrixEvent[] } }>;
  join?: Record<string, { timeline?: { events: MatrixEvent[]; limited?: boolean; prev_batch?: string }; state?: { events: MatrixEvent[] };
    unread_notifications?: JsonObject; account_data?: { events: JsonObject[] } }>;
  leave?: Record<string, unknown>;
} };
