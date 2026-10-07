import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { failure, success } from '@ctlflow/crossfire-kernel/result';

const relation = check.list(check.object({ fleetId: check.identifier, instanceKeys: check.list(check.name, 100) }), 100);
export const resumeSelections: typeof relation = input => {
  const parsed = relation(input);
  if (!parsed.ok) return parsed;
  if (new Set(parsed.value.map(item => item.fleetId)).size !== parsed.value.length
    || parsed.value.some(item => new Set(item.instanceKeys).size !== item.instanceKeys.length)) return failure('invalid', 'Duplicate saved resume selection');
  return success(parsed.value.map(item => ({ ...item, instanceKeys: item.instanceKeys.toSorted() })).toSorted((left, right) => left.fleetId.localeCompare(right.fleetId)));
};
