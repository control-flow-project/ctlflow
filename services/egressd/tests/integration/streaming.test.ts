import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  readHeader,
  requestEgressd
} from "../support/request-egressd.js";
import {
  waitFor
} from "../support/wait-for.js";
import {
  getEgressdTestSuite
} from "../suite/get-egressd-test-suite.js";

test("passes binary response bytes without interpretation", async () => {
  const response = await requestEgressd({ path: "/binary" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.body,
    Buffer.from([0, 1, 2, 3, 254, 255]));
  assert.equal(
    readHeader(response, "content-type"),
    "application/octet-stream");
});

test("streams server-sent events without interpretation", async () => {
  const response = await requestEgressd({ path: "/sse" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.toString(), "data: one\n\ndata: two\n\n");
  assert.equal(readHeader(response, "content-type"), "text/event-stream");
});

test("returns redirects without following them", async () => {
  const suite = getEgressdTestSuite();
  await suite.origin.clearEvidence();
  const response = await requestEgressd({ path: "/redirect" });
  assert.equal(response.statusCode, 302);
  assert.equal(
    readHeader(response, "location"),
    "https://elsewhere.invalid/escape");
  const evidence = await suite.origin.readEvidence();
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.target, "/redirect");
});

test("maps the finite upstream deadline to gateway timeout", async () => {
  const response = await requestEgressd({ path: "/deadline" });
  assert.equal(response.statusCode, 504);
  assert.equal(response.body.toString(), "Gateway timeout\n");
});

test("propagates caller cancellation to the upstream request", async () => {
  const suite = getEgressdTestSuite();
  await suite.origin.clearEvidence();
  const controller = new AbortController();
  const response = requestEgressd({
    path: "/cancel",
    signal: controller.signal
  });
  await waitFor(
    async () => (await suite.origin.readEvidence()).length === 1,
    "The controlled origin did not receive the cancellable request");
  controller.abort();
  await assert.rejects(response, /abort/iu);
  await waitFor(
    async () =>
      (await suite.origin.readEvidence())[0]?.cancelled === true,
    "Egressd did not cancel the upstream request");
});

test("maps an unavailable origin to bad gateway and stays ready",
  async () => {
    const suite = getEgressdTestSuite();
    await suite.origin.setAvailable(false);
    try {
      const response = await requestEgressd({ path: "/binary" });
      assert.equal(response.statusCode, 502);
      assert.equal(response.body.toString(), "Bad gateway\n");
      assert.equal(
        (await requestEgressd({
          path: "/readyz",
          probe: true
        })).statusCode,
        204);
    } finally {
      await suite.origin.setAvailable(true);
    }
  });
