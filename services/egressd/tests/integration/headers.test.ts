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

test("forwards only admitted request headers and applies replacements",
  async () => {
    const suite = getEgressdTestSuite();
    await suite.origin.clearEvidence();
    const response = await requestEgressd({
      method: "POST",
      path: "/headers",
      headers: [
        ["Accept", "application/json"],
        ["Authorization", "Bearer provider"],
        ["Content-Type", "application/octet-stream"],
        ["Cookie", "provider=session"],
        ["Forwarded", "for=private"],
        ["X-Forwarded-For", "private"],
        ["Ctlflow-Identity", "private"],
        ["X-App", "visible"],
        ["X-Hidden", "hidden"],
        ["X-Literal", "caller-value"],
        ["X-Secret", "caller-secret"]
      ],
      body: "payload"
    });
    assert.equal(response.statusCode, 200);
    const evidence = (await suite.origin.readEvidence())[0];
    assert.ok(evidence);
    const headers = evidence.headers;
    assert.deepEqual(headers.accept, ["application/json"]);
    assert.deepEqual(headers.authorization, ["Bearer provider"]);
    assert.deepEqual(headers.cookie, ["provider=session"]);
    assert.deepEqual(headers["x-app"], ["visible"]);
    assert.deepEqual(headers["x-literal"], ["fixed-value"]);
    assert.deepEqual(headers["x-secret"], ["test-secret-material"]);
    assert.equal(headers["proxy-authorization"], undefined);
    assert.equal(headers.forwarded, undefined);
    assert.equal(headers["x-forwarded-for"], undefined);
    assert.equal(headers["ctlflow-identity"], undefined);
    assert.equal(headers["x-hidden"], undefined);
    assert.notEqual(headers.host?.[0], "egressd.internal");
  });

test("forwards only admitted response headers", async () => {
  const response = await requestEgressd({ path: "/status" });
  assert.equal(response.statusCode, 418);
  assert.equal(response.body.toString(), "ordinary status");
  assert.deepEqual(response.headers.get("x-upstream"), ["visible"]);
  assert.deepEqual(
    response.headers.get("set-cookie"),
    ["provider=value; Secure"]);
  assert.equal(response.headers.get("x-hidden"), undefined);
  assert.equal(response.headers.get("server"), undefined);
});

test("never exposes proxy credentials or replacement secrets downstream",
  async () => {
    const response = await requestEgressd({
      method: "POST",
      path: "/headers",
      body: "nonsecret"
    });
    assert.equal(response.statusCode, 200);
    const returned = response.body.toString();
    assert.equal(returned.includes("test-secret-material"), false);
    assert.equal(
      returned.includes(getEgressdTestSuite().caller.callerToken),
      false);
  });
