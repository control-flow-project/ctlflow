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
  sessionCookie
} from "../support/browser-flow.js";
import {
  requestAuthd
} from "../support/request-authd.js";
import {
  readAllExports
} from "../support/telemetry/read-all-exports.js";
import {
  hasHttpCompletionLog
} from "../support/telemetry/has-http-completion-log.js";
import {
  readOtlpSpans
} from "../support/telemetry/read-otlp-spans.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";

test("exports correlated route and dependency telemetry without secrets",
  async () => {
    const traceId = "1234567890abcdef1234567890abcdef";
    const suite = getAuthdTestSuite();
    await suite.collector.resume();
    await suite.collector.clearExports();
    await suite.provider.setMode("available");
    await suite.provider.clearEvidence();
    const begun = await beginAuthentication(
      "/telemetry-secret-target");
    const authorization = await suite.provider.authorize(
      begun.authorizationLocation);
    const callbackUrl = new URL(authorization.location);
    const callback = await requestAuthd({
      method: "GET",
      path: `${callbackUrl.pathname}${callbackUrl.search}`,
      headers: [
        ["Host", "auth.example.test"],
        ["Cookie", begun.stateCookie],
        [
          "traceparent",
          `00-${traceId}-1234567890abcdef-01`
        ]
      ]
    });
    assert.equal(callback.statusCode, 303);
    const session = sessionCookie(callback);
    assert.ok(session);
    const logout = await requestAuthd({
      method: "POST",
      path: "/auth/v1/logout",
      headers: [
        ...browserPostHeaders("", session),
        [
          "traceparent",
          `00-${traceId}-fedcba0987654321-01`
        ]
      ]
    });
    assert.equal(logout.statusCode, 303);

    await waitForExport(
      suite.collector.tracesPath,
      (value) => {
        const exported = readOtlpSpans(value);
        if (!exported.some(
            (span) => span.name === "authd.http.begin")) {
          return false;
        }
        const spans = exported.filter(
          (span) => span.traceId === traceId);
        const callbackSpan = spans.find(
          (span) => span.name === "authd.http.callback");
        const logoutSpan = spans.find(
          (span) => span.name === "authd.http.logout");
        if (typeof callbackSpan?.spanId !== "string"
            || typeof logoutSpan?.spanId !== "string") {
          return false;
        }
        return [
          "authd.identity.validate_login_provider",
          "authd.egress.token",
          "authd.egress.userinfo",
          "authd.identity.create_session"
        ].every((name) => spans.some((span) =>
          span.name === name
          && span.parentSpanId === callbackSpan.spanId))
          && spans.some((span) =>
            span.name === "authd.identity.revoke_session"
            && span.parentSpanId === logoutSpan.spanId)
          && spans.some((span) =>
            span.name === "egressd.http.post")
          && spans.some((span) =>
            span.name === "egressd.http.get");
      });
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
        hasHttpCompletionLog(
          value,
          "authd.http.callback",
          "authenticated",
          traceId)
        && hasHttpCompletionLog(
          value,
          "authd.http.logout",
          "logged_out",
          traceId));

    const provider = await suite.provider.readEvidence();
    assert.equal(provider.tokens.length, 1);
    assert.equal(provider.userInfo.length, 1);
    assert.equal(provider.tokens[0]!.traceparent, undefined);
    assert.equal(provider.userInfo[0]!.traceparent, undefined);
    const spans = readOtlpSpans(
      await readAllExports(suite.collector))
      .filter((span) => span.traceId === traceId);
    assert.equal(
      spans.some((span) => span.name === "egressd.http.post"),
      true);
    assert.equal(
      spans.some((span) => span.name === "egressd.http.get"),
      true);
    const exports = await readAllExports(suite.collector);
    for (const secret of [
      "acme",
      "oidc",
      "alice@example.com",
      "/telemetry-secret-target",
      begun.stateCookie,
      session,
      callbackUrl.searchParams.get("code") ?? "",
      provider.tokens[0]?.authorization ?? "",
      provider.tokens[0]?.body ?? "",
      provider.userInfo[0]?.authorization ?? ""
    ]) {
      assert.notEqual(secret, "");
      assert.equal(exports.includes(secret), false);
    }
  });

test("replaces malformed trace context and ignores baggage",
  async () => {
    const suite = getAuthdTestSuite();
    const rejectedTraceId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const before = readOtlpSpans(
      await readAllExports(suite.collector))
      .filter((span) => span.name === "authd.http.begin")
      .length;
    const body = "tenant_id=unknown&provider_id=oidc";
    const response = await requestAuthd({
      method: "POST",
      path: "/auth/v1/begin",
      headers: [
        ["Host", "auth.example.test"],
        ["Origin", "https://auth.example.test"],
        ["Content-Type", "application/x-www-form-urlencoded"],
        ["Content-Length", String(Buffer.byteLength(body))],
        [
          "traceparent",
          `00-${rejectedTraceId}-0000000000000000-01`
        ],
        ["baggage", "credential=forbidden"]
      ],
      body
    });
    assert.equal(response.statusCode, 400);
    await waitForExport(
      suite.collector.tracesPath,
      (value) => {
        const spans = readOtlpSpans(value)
          .filter((span) => span.name === "authd.http.begin");
        return spans.length > before
          && spans.slice(before).some((span) =>
            typeof span.traceId === "string"
            && /^[0-9a-f]{32}$/u.test(span.traceId)
            && span.traceId !== rejectedTraceId);
      });
    const exports = await readAllExports(suite.collector);
    assert.equal(exports.includes("credential=forbidden"), false);
    assert.equal(
      readOtlpSpans(exports).some((span) =>
        span.traceId === rejectedTraceId),
      false);
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
