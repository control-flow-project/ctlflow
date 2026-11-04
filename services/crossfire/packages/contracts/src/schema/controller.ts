import * as check from './validation.js';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';

function metadata(input: unknown): Result<Record<string, string>> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 16) return failure('invalid', 'Controller metadata supports at most 16 text fields');
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^[a-z][a-z0-9-]{0,39}$/u.test(key) || !check.text(256, 0)(value).ok || typeof value !== 'string') return failure('invalid', 'Invalid controller metadata');
    output[key] = value;
  }
  return success(output);
}
export const controller = check.object({ name: check.text(100), metadata: check.optional(metadata) });
