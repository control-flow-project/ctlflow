import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  getAuthdTestSuite
} from "../suite/get-authd-test-suite.js";
import {
  beginAuthentication,
  browserPostHeaders,
  completeAuthentication,
  sessionCookie
} from "../support/browser-flow.js";
import {
  requestAuthd
} from "../support/request-authd.js";
import {
  readAllExports
} from "../support/telemetry/read-all-exports.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";

test("exports correlated route and dependency telemetry without secrets",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.collector.resume();
    await suite.collector.clearExports();
    await suite.provider.setMode("available");
    await suite.provider.clearEvidence();
    await suite.egressd.clearEvidence();
    const completed = await completeAuthentication(
      "/telemetry-secret-target");
    assert.equal(completed.callback.statusCode, 303);
    const session = sessionCookie(completed.callback);
    assert.ok(session);
    const logout = await requestAuthd({
      method: "POST",
      path: "/auth/v1/logout",
      headers: browserPostHeaders("", session)
    });
    assert.equal(logout.statusCode, 303);

    await waitForExport(
      suite.collector.tracesPath,
      (value) =>
        value.includes("authd.http.begin")
        && value.includes("authd.http.callback")
        && value.includes("authd.http.logout")
        && value.includes("authd.egress.token")
        && value.includes("authd.egress.userinfo")
        && value.includes("authd.identity.create_session")
        && value.includes("authd.identity.revoke_session"));
    await waitForExport(
      suite.collector.metricsPath,
      (value) =>
        value.includes("ctlflow.authd.http.requests")
        && value.includes("ctlflow.authd.http.duration")
        && value.includes("ctlflow.authd.dependency.requests")
        && value.includes("ctlflow.authd.public.in_flight")
        && value.includes("ctlflow.authd.callbacks.in_flight")
        && value.includes("ctlflow.authd.attempts.in_flight"));
    await waitForExport(
      suite.collector.logsPath,
      (value) =>
        value.includes("authd.http.begin")
        && value.includes("authd.http.callback")
        && value.includes("authd.http.logout"));

    const provider = await suite.provider.readEvidence();
    const egress = await suite.egressd.readEvidence();
    const exports = await readAllExports(suite.collector);
    for (const secret of [
      "acme",
      "oidc",
      "alice@example.com",
      "/telemetry-secret-target",
      completed.begin.stateCookie,
      session,
      new URL(completed.providerLocation).searchParams.get("code") ?? "",
      provider.tokens[0]?.authorization ?? "",
      provider.tokens[0]?.body ?? "",
      egress[1]?.authorization ?? ""
    ]) {
      assert.notEqual(secret, "");
      assert.equal(exports.includes(secret), false);
    }
  });

test("replaces malformed trace context and ignores baggage",
  async () => {
    const body = "tenant_id=unknown&provider_id=oidc";
    const response = await requestAuthd({
      method: "POST",
      path: "/auth/v1/begin",
      headers: [
        ["Host", "auth.example.test"],
        ["Origin", "https://auth.example.test"],
        ["Content-Type", "application/x-www-form-urlencoded"],
        ["Content-Length", String(Buffer.byteLength(body))],
        ["traceparent", "not-a-traceparent"],
        ["baggage", "credential=forbidden"]
      ],
      body
    });
    assert.equal(response.statusCode, 400);
  });

test("continues browser operation during Collector outage",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.collector.suspend();
    try {
      const begun = await beginAuthentication("/collector-outage");
      assert.equal(begun.response.statusCode, 303);
    } finally {
      await suite.collector.resume();
    }
  });
