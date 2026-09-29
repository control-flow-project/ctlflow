import * as check from '../schema/validation.js';
import { failure, success, type Result } from '@crossfire/kernel/result';

export const metadata = check.object({ requestId: check.identifier, page: check.optional(check.integer(1)),
  pageSize: check.optional(check.integer(1, 100)), totalItems: check.optional(check.integer()), totalPages: check.optional(check.integer()) });
export type Metadata = check.Parsed<typeof metadata>;
export type Response<Value> = { data: Value; meta: Metadata };
const errorCode = check.choice('invalid', 'unauthorized', 'forbidden', 'missing', 'conflict', 'limit', 'native', 'unavailable',
  'stale_revision', 'name_collision', 'capacity', 'rate_limit', 'body_too_large', 'method_not_allowed');

export function decodeResponse<Value>(input: unknown, parse: check.Parser<Value>, collection: boolean): Result<Response<Value>> {
  if (!input || typeof input !== 'object' || !('data' in input) || !('meta' in input)
    || Object.keys(input).some(key => key !== 'data' && key !== 'meta')) return failure('native', 'Invalid API response envelope');
  const decoded = parse(input.data), parsedMeta = metadata(input.meta);
  if (!decoded.ok || !parsedMeta.ok) return failure('native', 'Invalid API response representation');
  const meta = parsedMeta.value;
  if (collection && (meta.page === undefined || meta.pageSize === undefined || meta.totalItems === undefined || meta.totalPages === undefined)) {
    return failure('native', 'API collection pagination is missing');
  }
  return success({ data: decoded.value, meta });
}

export function decodeFailure(input: unknown): Result<never> {
  if (!input || typeof input !== 'object' || !('error' in input) || !('meta' in input) || !metadata(input.meta).ok) return failure('native', 'Invalid API failure response');
  const error = input.error;
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) return failure('native', 'Invalid API error');
  const code = errorCode(error.code), message = check.text(8192)(error.message);
  return code.ok && message.ok ? failure(code.value, message.value) : failure('native', 'Invalid API error');
}
