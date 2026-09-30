import * as check from '@crossfire/contracts/schema/validation';
import { deliveryJournal, deliveryText } from '@crossfire/adapter-runtime/journal';

export type HistoryBoundary = { position: number; key: string };
export type Delivery = { turn: string | null; text: string; messageId: string; boundary: HistoryBoundary | null; initializing: boolean };
const delivery = check.object({ turn: check.nullable(check.text(200)), text: deliveryText, messageId: check.text(200),
  boundary: check.nullable(check.object({ position: check.integer(0, Number.MAX_SAFE_INTEGER), key: check.text(1000) })), initializing: check.boolean });

export function deliveryState(file: string, sessionId: string) {
  return deliveryJournal(file, sessionId, delivery);
}
