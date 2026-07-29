import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  requestEgressd
} from "../support/request-egressd.js";
import {
  getEgressdTestSuite
} from "../suite/get-egressd-test-suite.js";

test("rejects a request target larger than 16 KiB", async () => {
  const response = await requestEgressd({
    path: `/nested/${"a".repeat(17 * 1024)}`
  });
  assert.equal(response.statusCode, 414);
  assert.equal(response.body.toString(), "Request target too large\n");
});

test("rejects request headers larger than 32 KiB", async () => {
  const response = await requestEgressd({
    headers: [["X-Large", "a".repeat(33 * 1024)]]
  });
  assert.equal(response.statusCode, 431);
  assert.equal(
    response.body.toString(),
    "Request headers too large\n");
});

test("rejects an oversized request with a declared length", async () => {
  const suite = getEgressdTestSuite();
  await suite.origin.clearEvidence();
  const response = await requestEgressd({
    method: "POST",
    path: "/small-request",
    body: "a".repeat(17)
  });
  assert.equal(response.statusCode, 413);
  assert.equal(response.body.toString(), "Request body too large\n");
  assert.equal((await suite.origin.readEvidence()).length, 0);
});

test("rejects an oversized chunked request while streaming", async () => {
  const response = await requestEgressd({
    method: "POST",
    path: "/small-request",
    body: "a".repeat(17),
    chunked: true
  });
  assert.equal(response.statusCode, 413);
  assert.equal(response.body.toString(), "Request body too large\n");
});

test("rejects a declared oversized upstream response before commitment",
  async () => {
    const response = await requestEgressd({ path: "/known-large" });
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.toString(), "Bad gateway\n");
  });

test("aborts an oversized upstream response after streaming commitment",
  async () => {
    const suite = getEgressdTestSuite();
    await assert.rejects(
      requestEgressd({ path: "/stream-large" }),
      /aborted|reset|closed/iu);
    await suite.egressd.reconnect();
  });
