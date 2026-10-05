import { failure, success, type Result } from '@crossfire/kernel/result';
import type { BinaryInput } from '@crossfire/kernel/bytes';
export function binaryInput(value: unknown): Result<BinaryInput> {
  if (!value || typeof value !== 'object' || !('byteLength' in value) || !('chunks' in value)
    || typeof value.byteLength !== 'number' || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0
    || !value.chunks || typeof value.chunks !== 'object' || !(Symbol.asyncIterator in value.chunks)
    || typeof value.chunks[Symbol.asyncIterator] !== 'function') return failure('invalid', 'A sized binary stream is required');
  return success({ byteLength: value.byteLength, chunks: value.chunks as AsyncIterable<Uint8Array> });
}
