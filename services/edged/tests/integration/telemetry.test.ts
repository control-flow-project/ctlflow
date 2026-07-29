import assert from "node:assert/strict";
import {
  readFile
} from "node:fs/promises";
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
  readAllExports
} from "../support/telemetry/read-all-exports.js";
import {
  readOtlpSpans
} from "../support/telemetry/read-otlp-spans.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";
import {
  getEdgedTestSuite
} from "../suite/get-edged-test-suite.js";

test("exports correlated request and dependency telemetry without data",
  async () => {
    const suite = getEdgedTestSuite();
    await suite.collector.resume();
    await suite.collector.clearExports();
    const credential = await suite.session();
    const traceId = "11111111111111111111111111111111";
    const response = await requestEdged({
      path: "/private-path?secret-query=hidden",
      headers: [
        ["Cookie", `${sessionCookie(credential)}; private=hidden`],
        ["X-Private", "secret-header"],
        [
          "Traceparent",
          `00-${traceId}-2222222222222222-01`
        ]
      ]
    });
    assert.equal(response.statusCode, 200);
    await waitForExport(
      suite.collector.tracesPath,
      (value) => hasCorrelatedTrace(value, traceId));
    await waitForExport(
      suite.collector.metricsPath,
      (value) => value.includes("ctlflow.edged.requests"));
    await waitForExport(
      suite.collector.logsPath,
      (value) =>
        value.includes("EdgedRequestCompleted")
        && value.includes("edged.http.get"));

    const traceText = await readFile(
      suite.collector.tracesPath,
      "utf8");
    const spans = readOtlpSpans(traceText)
      .filter((span) => span.traceId === traceId);
    const server = spans.find(
      (span) => span.name === "edged.http.get");
    const identity = spans.find(
      (span) => span.name === "edged.identity.exchange_session");
    const application = spans.find(
      (span) => span.name === "edged.application");
    assert.ok(server?.spanId);
    assert.equal(identity?.parentSpanId, server.spanId);
    assert.equal(application?.parentSpanId, server.spanId);

    const exports = await readAllExports(suite.collector);
    for (const secret of [
      "private-path",
      "secret-query",
      "secret-header",
      "private=hidden",
      credential,
      "acme",
      "atlas"
    ]) {
      assert.equal(exports.includes(secret), false);
    }
  });

function hasCorrelatedTrace(value: string, traceId: string): boolean {
  const spans = readOtlpSpans(value)
    .filter((span) => span.traceId === traceId);
  const server = spans.find(
    (span) => span.name === "edged.http.get");
  if (typeof server?.spanId !== "string") {
    return false;
  }
  return spans.some((span) =>
    span.name === "edged.identity.exchange_session"
      && span.parentSpanId === server.spanId)
    && spans.some((span) =>
      span.name === "edged.application"
        && span.parentSpanId === server.spanId);
}

test("replaces malformed trace context and discards baggage",
  async () => {
    const credential = await getEdgedTestSuite().session();
    const response = await requestEdged({
      headers: [
        ["Cookie", sessionCookie(credential)],
        ["Traceparent", "malformed"],
        ["Tracestate", "private=state"],
        ["Baggage", "private=value"]
      ]
    });
    assert.equal(response.statusCode, 200);
    const headers = parseApplicationEvidence(response.body).headers;
    assert.match(
      String(headers.traceparent),
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/u);
    assert.notEqual(headers.traceparent, "malformed");
    assert.equal(headers.tracestate, undefined);
    assert.equal(headers.baggage, undefined);
  });

test("continues proxying during Collector outage",
  async () => {
    const suite = getEdgedTestSuite();
    const credential = await suite.session();
    await suite.collector.suspend();
    try {
      const response = await requestEdged({
        headers: [["Cookie", sessionCookie(credential)]]
      });
      assert.equal(response.statusCode, 200);
    } finally {
      await suite.collector.resume();
    }
  });
