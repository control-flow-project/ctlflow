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

test("admits at most 256 active requests without a queue", async () => {
  const suite = getEgressdTestSuite();
  await suite.origin.clearEvidence();
  const controllers = Array.from(
    { length: 256 },
    () => new AbortController());
  const active = controllers.map(async (controller) => {
    try {
      return await requestEgressd({
        path: "/slow",
        signal: controller.signal
      });
    } catch (error) {
      return error;
    }
  });
  try {
    await waitFor(
      async () => (await suite.origin.readEvidence()).length === 256,
      "Egressd did not admit 256 active requests",
      1_750);
    const overflow = await requestEgressd({ path: "/slow" });
    assert.equal(overflow.statusCode, 429);
    assert.equal(readHeader(overflow, "retry-after"), "1");
    assert.equal(overflow.body.toString(), "Capacity exhausted\n");
  } finally {
    for (const controller of controllers) {
      controller.abort();
    }
    await Promise.allSettled(active);
    await waitFor(
      async () => (await requestEgressd()).statusCode === 200,
      "Egressd did not release admission after cancellation");
  }
});
