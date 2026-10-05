export type BinaryInput = { byteLength: number; chunks: AsyncIterable<Uint8Array> };
export function binaryBytes(bytes: Uint8Array): BinaryInput {
  return { byteLength: bytes.byteLength, chunks: { async *[Symbol.asyncIterator]() { yield bytes; } } };
}
