import assert from "node:assert/strict";
import {
  readHeader,
  type AuthdHttpResponse
} from "./request-authd.js";

export function assertSecurityHeaders(
  response: AuthdHttpResponse
): void {
  assert.equal(readHeader(response, "cache-control"), "no-store");
  assert.equal(readHeader(response, "referrer-policy"), "no-referrer");
  assert.equal(
    readHeader(response, "x-content-type-options"),
    "nosniff");
  assert.equal(
    readHeader(response, "content-security-policy"),
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}

export function assertNonDisclosingError(
  response: AuthdHttpResponse,
  statusCode: number
): void {
  assert.equal(response.statusCode, statusCode);
  assert.equal(response.body, "Request could not be completed.");
  assert.equal(
    readHeader(response, "content-type"),
    "text/plain; charset=utf-8");
  assertSecurityHeaders(response);
  assert.equal(readHeader(response, "location"), undefined);
}
