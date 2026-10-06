import assert from 'node:assert/strict';
import type { Result } from '@ctlflow/crossfire-kernel/result';

export function value<Value>(result: Result<Value>): Value {
  if (!result.ok) assert.fail(result.error.code + ': ' + result.error.message);
  return result.value;
}
