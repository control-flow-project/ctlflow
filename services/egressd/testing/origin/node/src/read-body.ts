import type {
  IncomingMessage
} from "node:http";

export async function readBody(
  request: IncomingMessage,
  maximumBytes: number
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumBytes) {
      throw new Error("Body exceeds controlled-origin limit");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
