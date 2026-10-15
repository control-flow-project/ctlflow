import type { IncomingMessage } from 'node:http';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { BinaryInput } from '@ctlflow/crossfire-kernel/bytes';
export function readBinary(request: IncomingMessage, maximum: number): Result<BinaryInput> {
  if (request.headers['content-type'] !== 'application/octet-stream') return failure('invalid', 'Expected application/octet-stream');
  const declared = request.headers['content-length'];
  if (typeof declared !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)))
    return failure('invalid', 'An exact Content-Length is required for binary input');
  const byteLength = Number(declared);
  if (byteLength > maximum) return failure('body_too_large', 'Binary request exceeds its operation bound');
  const chunks: AsyncIterable<Uint8Array> = { async *[Symbol.asyncIterator]() {
    for await (const chunk of request) {
      if (!(chunk instanceof Uint8Array)) throw new Error('Invalid binary transport chunk');
      yield chunk;
    }
  } };
  return success({ byteLength, chunks });
}
