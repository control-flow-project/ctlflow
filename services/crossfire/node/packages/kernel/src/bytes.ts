export type BinaryInput = { byteLength: number; chunks: AsyncIterable<Uint8Array> };
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export function decodeUtf8(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}
export function binaryBytes(bytes: Uint8Array): BinaryInput {
  return { byteLength: bytes.byteLength, chunks: { async *[Symbol.asyncIterator]() { yield bytes; } } };
}
