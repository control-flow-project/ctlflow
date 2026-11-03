import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { failure } from '@ctlflow/crossfire-kernel/result';
const scope = check.object({ fleetId: check.nullable(check.identifier), instanceKey: check.nullable(check.name) });
export const diagnosticReport = check.object({ checkedAt: check.integer(), scope,
  checks: check.list(check.object({ id: check.text(100), scope, status: check.choice('pass', 'fail', 'unknown', 'not-applicable'),
    observedAt: check.nullable(check.integer()), message: check.text(1024), remediation: check.nullable(check.text(1024)) }), 1000) });
export function diagnosticQuery(input: unknown) {
  if (!(input instanceof URLSearchParams) || [...input.keys()].some(key => !['fleetId', 'instanceKey'].includes(key))
    || input.getAll('fleetId').length > 1 || input.getAll('instanceKey').length > 1) return failure('invalid', 'Use one exact diagnostic scope');
  const parsed = scope({ fleetId: input.get('fleetId'), instanceKey: input.get('instanceKey') });
  return parsed.ok && parsed.value.instanceKey !== null && parsed.value.fleetId === null ? failure('invalid', 'An instance requires a fleet') : parsed;
}
