import type { BinaryInput } from '@crossfire/kernel/bytes';
export function binaryRequest(input: BinaryInput): ReadableStream<Uint8Array> {
  const iterator = input.chunks[Symbol.asyncIterator](); let size = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          if (size !== input.byteLength) throw new Error('Binary request size changed');
          controller.close(); return;
        }
        if (!(next.value instanceof Uint8Array) || (size += next.value.byteLength) > input.byteLength) throw new Error('Binary request exceeds its size');
        controller.enqueue(next.value);
      } catch (error) { try { await iterator.return?.(); } finally { controller.error(error); } }
    },
    async cancel() { await iterator.return?.(); },
  });
}
