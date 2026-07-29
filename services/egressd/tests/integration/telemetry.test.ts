import assert from "node:assert/strict";
import {
  readFile
} from "node:fs/promises";
import {
  test
} from "node:test";
import {
  requestEgressd
} from "../support/request-egressd.js";
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
  getEgressdTestSuite
} from "../suite/get-egressd-test-suite.js";

test("correlates local proxy telemetry and forwards trace only by rule",
  async () => {
    const suite = getEgressdTestSuite();
    await suite.collector.resume();
    const beforeTraces = (await readFile(
      suite.collector.tracesPath,
      "utf8")).length;
    const beforeMetrics = (await readFile(
      suite.collector.metricsPath,
      "utf8")).length;
    const beforeLogs = (await readFile(
      suite.collector.logsPath,
      "utf8")).length;
    await suite.origin.clearEvidence();
    const traceId = "11111111111111111111111111111111";
    const traceParent = `00-${traceId}-2222222222222222-01`;
    const traced = await requestEgressd({
      path: "/trace-on?private-query=hidden-value",
      headers: [
        ["Traceparent", traceParent],
        ["Tracestate", "vendor=value"],
        ["Baggage", "private=baggage"],
        ["X-Private", "private-header"]
      ]
    });
    assert.equal(traced.statusCode, 200);
    const untraced = await requestEgressd({
      path: "/trace-off",
      headers: [["Traceparent", traceParent]]
    });
    assert.equal(untraced.statusCode, 200);

    const evidence = await suite.origin.readEvidence();
    assert.equal(evidence.length, 2);
    assert.match(
      evidence[0]?.headers.traceparent?.[0] ?? "",
      new RegExp(`^00-${traceId}-[0-9a-f]{16}-[0-9a-f]{2}$`, "u"));
    assert.deepEqual(evidence[0]?.headers.tracestate, ["vendor=value"]);
    assert.equal(evidence[0]?.headers.baggage, undefined);
    assert.equal(evidence[1]?.headers.traceparent, undefined);

    await waitForExport(
      suite.collector.tracesPath,
      (value) =>
        value.length > beforeTraces
        && hasCorrelatedProxySpans(value, traceId));
    await waitForExport(
      suite.collector.metricsPath,
      (value) =>
        value.length > beforeMetrics
        && value.includes("ctlflow.egressd.requests"));
    await waitForExport(
      suite.collector.logsPath,
      (value) =>
        value.length > beforeLogs
        && value.includes("EgressdRequestCompleted")
        && value.includes("egressd.http.get"));

    const spans = readOtlpSpans(
      await readFile(suite.collector.tracesPath, "utf8"))
      .filter((span) => span.traceId === traceId);
    const server = spans.find(
      (span) => span.name === "egressd.http.get");
    const upstream = spans.find(
      (span) => span.name === "egressd.upstream");
    assert.ok(server?.spanId);
    assert.equal(upstream?.parentSpanId, server.spanId);

    const exports = await readAllExports(suite.collector);
    for (const privateValue of [
      "private-query",
      "hidden-value",
      "private-header",
      "private=baggage",
      suite.caller.callerToken,
      suite.callerServiceAccount,
      suite.kubernetes.namespace,
      suite.origin.endpoint,
      "test-secret-material"
    ]) {
      assert.equal(
        exports.includes(privateValue),
        false,
        privateValue);
    }
    for (const admittedDimension of [
      "ctlflow.operation",
      "ctlflow.rule_id",
      "ctlflow.outcome",
      "ctlflow.status_class",
      "ctlflow.egressd.duration",
      "ctlflow.egressd.saturation"
    ]) {
      assert.equal(
        exports.includes(admittedDimension),
        true,
        admittedDimension);
    }
  });

test("replaces malformed trace context and never forwards baggage",
  async () => {
    const suite = getEgressdTestSuite();
    await suite.origin.clearEvidence();
    const response = await requestEgressd({
      path: "/trace-on",
      headers: [
        ["Traceparent", "malformed"],
        ["Tracestate", "private=state"],
        ["Baggage", "private=value"]
      ]
    });
    assert.equal(response.statusCode, 200);
    const headers = (await suite.origin.readEvidence())[0]?.headers;
    assert.match(
      headers?.traceparent?.[0] ?? "",
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/u);
    assert.equal(headers?.tracestate, undefined);
    assert.equal(headers?.baggage, undefined);
  });

test("continues proxying and stays ready during Collector outage",
  async () => {
    const suite = getEgressdTestSuite();
    await suite.collector.suspend();
    try {
      assert.equal((await requestEgressd()).statusCode, 200);
      assert.equal(
        (await requestEgressd({
          path: "/readyz",
          probe: true
        })).statusCode,
        204);
    } finally {
      await suite.collector.resume();
    }
  });

function hasCorrelatedProxySpans(
  value: string,
  traceId: string
): boolean {
  const spans = readOtlpSpans(value)
    .filter((span) => span.traceId === traceId);
  const server = spans.find(
    (span) => span.name === "egressd.http.get");
  return typeof server?.spanId === "string"
    && spans.some((span) =>
      span.name === "egressd.upstream"
        && span.parentSpanId === server.spanId);
}
