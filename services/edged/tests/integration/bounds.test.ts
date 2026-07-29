import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  assertBoundaryError
} from "../support/assert-boundary-error.js";
import {
  parseApplicationEvidence
} from "../support/application-evidence.js";
import {
  readHeader,
  requestEdged
} from "../support/request-edged.js";
import {
  sessionCookie
} from "../support/session-cookie.js";
import {
  getEdgedTestSuite
} from "../suite/get-edged-test-suite.js";

const maximumBodyBytes = 64 * 1024 * 1024;

test("enforces request-target, header, and cookie bounds",
  async () => {
    const suite = getEdgedTestSuite();
    const credential = await suite.session();
    const target = await requestEdged({
      path: `/${"x".repeat(16 * 1024)}`,
      headers: [["Cookie", sessionCookie(credential)]]
    });
    assertBoundaryError(target, 414, "Request target too large");

    const headers = await requestEdged({
      headers: [
        ["Cookie", sessionCookie(credential)],
        ["X-Large", "x".repeat(32 * 1024)]
      ]
    });
    assertBoundaryError(headers, 431, "Request headers too large");

    const cookies = await requestEdged({
      headers: [[
        "Cookie",
        `${sessionCookie(credential)}; app=${"x".repeat(8 * 1024)}`
      ]]
    });
    assertBoundaryError(cookies, 431, "Request cookies too large");
  });

test("enforces declared and streaming request-body bounds",
  async () => {
    const suite = getEdgedTestSuite();
    const credential = await suite.session();
    const declared = await requestEdged({
      method: "POST",
      headers: [
        ["Cookie", sessionCookie(credential)],
        ["Connection", "close"],
        ["Content-Length", String(maximumBodyBytes + 1)]
      ]
    });
    assertBoundaryError(
      declared,
      413,
      "Request body too large");

    const admittedStreaming = await requestEdged({
      method: "POST",
      headers: [["Cookie", sessionCookie(credential)]],
      body: Buffer.alloc(1024 * 1024, 0x61),
      chunked: true
    });
    assert.equal(
      admittedStreaming.statusCode,
      200,
      admittedStreaming.body.toString("utf8"));
    assert.equal(
      parseApplicationEvidence(admittedStreaming.body).bodyBytes,
      1024 * 1024);

    const streaming = await requestEdged({
      method: "POST",
      headers: [["Cookie", sessionCookie(credential)]],
      body: Buffer.alloc(maximumBodyBytes + 1, 0x61),
      chunked: true
    });
    assertBoundaryError(streaming, 413, "Request body too large");
  });

test("rejects oversized application responses before commitment",
  async () => {
    const credential = await getEdgedTestSuite().session();
    const response = await requestEdged({
      path: `/stream?bytes=${String(maximumBodyBytes + 1)}`,
      headers: [["Cookie", sessionCookie(credential)]]
    });
    assertBoundaryError(response, 502, "Bad gateway");
  });

test("enforces application deadlines with fixed 504",
  async () => {
    const credential = await getEdgedTestSuite().session();
    const response = await requestEdged({
      path: "/delay?milliseconds=2500",
      headers: [["Cookie", sessionCookie(credential)]]
    });
    assertBoundaryError(response, 504, "Gateway timeout");
  });

test("admits at most 256 active requests without queueing",
  async () => {
    const credential = await getEdgedTestSuite().session();
    const responses = await Promise.all(
      Array.from({ length: 257 }, async () =>
        await requestEdged({
          path: "/hold?milliseconds=1000",
          headers: [["Cookie", sessionCookie(credential)]]
        })));
    assert.equal(
      responses.filter((response) => response.statusCode === 429).length,
      1);
    assert.equal(
      responses.filter((response) => response.statusCode === 200).length,
      256);
    const limited = responses.find(
      (response) => response.statusCode === 429);
    assert.ok(limited);
    assertBoundaryError(limited, 429, "Capacity exhausted");
    assert.equal(readHeader(limited, "retry-after"), "1");
  });
