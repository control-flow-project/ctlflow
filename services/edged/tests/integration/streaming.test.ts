import assert from "node:assert/strict";
import {
  setTimeout as delay
} from "node:timers/promises";
import {
  test
} from "node:test";
import {
  parseApplicationEvidence
} from "../support/application-evidence.js";
import {
  requestEdged
} from "../support/request-edged.js";
import {
  sessionCookie
} from "../support/session-cookie.js";
import {
  getEdgedTestSuite
} from "../suite/get-edged-test-suite.js";

test("streams bounded binary responses and server-sent events",
  async () => {
    const credential = await getEdgedTestSuite().session();
    const binary = await requestEdged({
      path: "/stream?bytes=1048576",
      headers: [["Cookie", sessionCookie(credential)]]
    });
    assert.equal(binary.statusCode, 200);
    assert.equal(binary.body.length, 1_048_576);
    assert.equal(binary.body[0], 0x61);
    assert.equal(binary.body.at(-1), 0x61);

    const events = await requestEdged({
      path: "/events",
      headers: [["Cookie", sessionCookie(credential)]]
    });
    assert.equal(events.statusCode, 200);
    assert.equal(
      events.headers.get("content-type")?.[0],
      "text/event-stream");
    assert.equal(
      events.body.toString("utf8"),
      "event: first\ndata: one\n\n"
      + "event: second\ndata: two\n\n"
      + "event: final\ndata: three\n\n");
  });

test("propagates public cancellation to the application request",
  async () => {
    const credential = await getEdgedTestSuite().session();
    const before = await requestEdged({
      headers: [["Cookie", sessionCookie(credential)]]
    });
    const initial = parseApplicationEvidence(before.body)
      .abortedRequests;
    const controller = new AbortController();
    const request = requestEdged({
      path: "/hold?milliseconds=5000",
      headers: [["Cookie", sessionCookie(credential)]],
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(request, (error: unknown) =>
      error instanceof Error && error.name === "AbortError");

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const after = await requestEdged({
        headers: [["Cookie", sessionCookie(credential)]]
      });
      if (parseApplicationEvidence(after.body).abortedRequests
          > initial) {
        return;
      }
      await delay(100);
    }
    assert.fail("Application did not observe public cancellation");
  });
