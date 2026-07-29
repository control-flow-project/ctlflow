import assert from "node:assert/strict";
import type {
  EdgedHttpResponse
} from "./request-edged.js";
import {
  readHeader
} from "./request-edged.js";

export function assertBoundaryError(
  response: EdgedHttpResponse,
  statusCode: number,
  body: string
): void {
  assert.equal(response.statusCode, statusCode);
  assert.equal(response.body.toString("utf8"), `${body}\n`);
  assert.equal(
    readHeader(response, "content-type"),
    "text/plain; charset=utf-8");
  assert.equal(
    readHeader(response, "content-length"),
    String(Buffer.byteLength(`${body}\n`)));
}
