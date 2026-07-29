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
  readHeaders,
  requestEdged
} from "../support/request-edged.js";
import {
  sessionCookie
} from "../support/session-cookie.js";
import {
  getEdgedTestSuite
} from "../suite/get-edged-test-suite.js";

test("replaces protected request context and retains application data",
  async () => {
    const credential = await getEdgedTestSuite().session();
    const response = await requestEdged({
      method: "POST",
      path: "/inspect?raw=a%2Fb",
      headers: [
        [
          "Cookie",
          `${sessionCookie(credential)}; application=value`
        ],
        ["Authorization", "Bearer attacker"],
        ["Proxy-Authorization", "Basic attacker"],
        ["Forwarded", "for=attacker"],
        ["X-Forwarded-For", "attacker"],
        ["Ctlflow-Principal", "attacker"],
        ["Connection", "x-hop-request"],
        ["X-Hop-Request", "attacker"],
        ["X-Application-Header", "retained"],
        ["Baggage", "secret=value"],
        ["Traceparent", "malformed"]
      ],
      body: "payload"
    });
    assert.equal(response.statusCode, 200);
    const evidence = parseApplicationEvidence(response.body);
    assert.equal(evidence.target, "/inspect?raw=a%2Fb");
    assert.equal(evidence.headers.cookie, "application=value");
    assert.equal(
      evidence.headers["x-application-header"],
      "retained");
    assert.match(
      String(evidence.headers.authorization),
      /^Bearer [^.]+\.[^.]+\.[^.]+$/u);
    assert.notEqual(evidence.headers.authorization, "Bearer attacker");
    assert.match(
      String(evidence.headers.traceparent),
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/u);
    for (const name of [
      "proxy-authorization",
      "forwarded",
      "x-forwarded-for",
      "ctlflow-principal",
      "x-hop-request",
      "baggage"
    ]) {
      assert.equal(evidence.headers[name], undefined);
    }
    assert.notEqual(
      evidence.headers.host,
      "application.example.test");
  });

test("retains application response headers and cookies only",
  async () => {
    const credential = await getEdgedTestSuite().session();
    const response = await requestEdged({
      path: "/response-headers",
      headers: [["Cookie", sessionCookie(credential)]]
    });
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers.get("x-application-header")?.[0],
      "retained");
    assert.deepEqual(
      readHeaders(response, "set-cookie"),
      ["application=value; Path=/; HttpOnly"]);
    assert.equal(response.headers.has("x-hop-response"), false);
    assert.equal(response.headers.has("connection"), false);
  });

test("passes ordinary application status, media type, and body",
  async () => {
    const credential = await getEdgedTestSuite().session();
    const response = await requestEdged({
      path: "/status?code=418",
      headers: [["Cookie", sessionCookie(credential)]]
    });
    assert.equal(response.statusCode, 418);
    assert.equal(
      response.headers.get("content-type")?.[0],
      "application/json");
    assert.equal(
      parseApplicationEvidence(response.body).target,
      "/status?code=418");
  });

test("maps an unavailable application connection to fixed 502",
  async () => {
    const credential = await getEdgedTestSuite().session();
    const response = await requestEdged({
      path: "/close",
      headers: [["Cookie", sessionCookie(credential)]]
    });
    assertBoundaryError(response, 502, "Bad gateway");
  });
