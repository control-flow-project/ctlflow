import { object, text, integer, optional } from '@ctlflow/crossfire-contracts/schema/validation';
export const matrixDirectorySearch = object({ search_term: text(200, 0), limit: optional(integer(0, 100)) });
export type MatrixDirectoryResult = { results: { user_id: string; display_name: string }[]; limited: boolean };
