import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { deliveryText } from '@ctlflow/crossfire-adapter-runtime/journal';

export type HistoryBoundary = { position: number; key: string };
export type CodexPublication = { turn: string | null; text: string; messageId: string; boundary: HistoryBoundary | null; initializing: boolean };
export type CodexInput = CodexPublication & { resumption?: CodexPublication };
const publication = { turn: check.nullable(check.text(200)), text: deliveryText, messageId: check.text(200),
  boundary: check.nullable(check.object({ position: check.integer(0, Number.MAX_SAFE_INTEGER), key: check.text(1000) })), initializing: check.boolean };
export const codexInput = check.object({ ...publication, resumption: check.optional(check.object(publication)) }) satisfies check.Parser<CodexInput>;
