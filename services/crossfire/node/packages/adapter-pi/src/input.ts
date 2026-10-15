import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { historyBoundary } from '@ctlflow/crossfire-adapter-runtime/native-file';
import { deliveryText } from '@ctlflow/crossfire-adapter-runtime/journal';
const publication = { messageId: check.text(200), text: deliveryText, boundary: historyBoundary, published: check.boolean };
export const piInput = check.object({ ...publication, resumption: check.optional(check.object(publication)) });
export type PiInput = check.Parsed<typeof piInput>;
