import * as check from '@crossfire/contracts/schema/validation';
import { failure, success, type Result } from '@crossfire/kernel/result';

function connection(input: unknown): Result<Record<string, string>> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 8) return failure('invalid', 'Invalid runtime attachment data');
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const field = check.text(64)(key), content = check.text(4096)(value);
    if (!field.ok) return field;
    if (!content.ok) return content;
    Object.defineProperty(fields, key, { value: content.value, enumerable: true, writable: true, configurable: true });
  }
  return success(fields);
}

export const attachment = check.object({ runtime: check.name, sessionId: check.text(200), workspace: check.text(4096), connection });
