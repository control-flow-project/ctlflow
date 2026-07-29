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

const methods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS"
] as const;

test("forwards every admitted HTTP method at root", async () => {
  const suite = getEgressdTestSuite();
  for (const method of methods) {
    await suite.origin.clearEvidence();
    const body = method === "GET" || method === "HEAD"
      ? undefined
      : `root-${method}`;
    const response = await requestEgressd({
      method,
      ...(body === undefined ? {} : { body })
    });
    assert.equal(response.statusCode, 200, method);
    if (method === "HEAD") {
      assert.equal(response.body.byteLength, 0);
    }
    const evidence = await suite.origin.readEvidence();
    assert.equal(evidence.length, 1, method);
    assert.equal(evidence[0]?.method, method);
    assert.equal(evidence[0]?.target, "/echo");
    assert.equal(
      Buffer.from(evidence[0]?.bodyBase64 ?? "", "base64").toString(),
      body ?? "");
  }
});

test("forwards every admitted HTTP method at a nested path", async () => {
  const suite = getEgressdTestSuite();
  for (const method of methods) {
    await suite.origin.clearEvidence();
    const body = method === "GET" || method === "HEAD"
      ? undefined
      : `nested-${method}`;
    const response = await requestEgressd({
      method,
      path: "/nested/child?order=1",
      ...(body === undefined ? {} : { body })
    });
    assert.equal(response.statusCode, 200, method);
    const evidence = await suite.origin.readEvidence();
    assert.equal(evidence.length, 1, method);
    assert.equal(evidence[0]?.method, method);
    assert.equal(evidence[0]?.target, "/echo/child?order=1");
  }
});

test("serves health and readiness only on the probe listener", async () => {
  for (const path of ["/healthz", "/readyz"]) {
    const probe = await requestEgressd({ path, probe: true });
    assert.equal(probe.statusCode, 204);
    assert.equal(probe.body.byteLength, 0);

    const privateResponse = await requestEgressd({ path });
    assert.equal(privateResponse.statusCode, 404);
  }
  assert.equal(
    (await requestEgressd({ path: "/unknown", probe: true })).statusCode,
    404);
  assert.equal(
    (await requestEgressd({
      method: "POST",
      path: "/healthz",
      probe: true
    })).statusCode,
    404);
});

test("rejects methods outside the fixed HTTP surface", async () => {
  const response = await requestEgressd({ method: "TRACE" });
  assert.equal(response.statusCode, 405);
  assert.equal(
    response.headers.get("allow")?.[0],
    "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
  assert.equal(response.body.toString(), "Method not allowed\n");
});
