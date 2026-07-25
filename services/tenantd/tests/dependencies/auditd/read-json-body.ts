import type { IncomingMessage } from "node:http";

const maximumBodyBytes = 16 * 1024;

export async function readJsonBody(
  request: IncomingMessage
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumBodyBytes) {
      throw new Error("Control request body is too large");
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
