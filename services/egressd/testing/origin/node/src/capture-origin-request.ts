import type {
  IncomingMessage
} from "node:http";
import type {
  OriginRequestEvidence
} from "./origin-request-evidence.js";
import {
  readBody
} from "./read-body.js";

export async function captureOriginRequest(
  request: IncomingMessage
): Promise<OriginRequestEvidence> {
  const headers: Record<string, string[]> = {};
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]?.toLowerCase();
    const value = request.rawHeaders[index + 1];
    if (name === undefined || value === undefined) {
      throw new Error("Controlled origin received malformed headers");
    }
    (headers[name] ??= []).push(value);
  }
  return {
    method: request.method ?? "",
    target: request.url ?? "",
    headers,
    bodyBase64: (await readBody(
      request,
      64 * 1024 * 1024)).toString("base64"),
    cancelled: false
  };
}
