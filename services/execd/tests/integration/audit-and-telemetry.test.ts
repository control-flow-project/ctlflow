import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import {
  Metadata,
  status
} from "@grpc/grpc-js";
import {
  RealizationPhase,
  RunPhase,
  type DeclarePlacementRequest,
  type DeclareWorkloadRequest,
  type ListPlacementsResponse,
  type ListRunsResponse,
  type ListWorkloadsResponse,
  type Placement,
  type Run,
  type Workload
} from "../generated/v1/execd.js";
import {
  getExecdTestContext
} from "../suite/get-execd-test-context.js";
import {
  getExecdTestSuite
} from "../suite/get-execd-test-suite.js";
import {
  createCapabilityMetadata
} from "../support/authorization/create-capability-metadata.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  declareTestApp
} from "../support/packages/declare-test-app.js";
import {
  createPlacementRequest
} from "../support/placements/create-placement-request.js";
import {
  findSpansForTrace
} from "../support/telemetry/find-spans-for-trace.js";
import {
  hasOperationLog
} from "../support/telemetry/has-operation-log.js";
import {
  readAllExports
} from "../support/telemetry/read-all-exports.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";
import {
  waitFor
} from "../support/wait-for.js";
import {
  createWorkloadRequest
} from "../support/workloads/create-workload-request.js";

test("records complete Placement, Workload, and Run mutation audit events",
  async () => {
    const context = getExecdTestContext();
    const baseline = (await context.auditd.readEvents()).length;
    const placementRequest = createPlacementRequest({
      placementId: "audit_mutations_placement",
      target: { global: {} }
    });
    const placement = await declarePlacement(placementRequest);
    const updatedPlacement = await declarePlacement({
      ...placementRequest,
      expectedRevision: placement.revision,
      constraints: {
        ...placementRequest.constraints!,
        maxReplicasPerContinuousWorkload: 3
      }
    });
    await declareTestApp(context.pkgd.client, {
      appId: "audit_mutations_app",
      placementId: placement.placementId,
      scope: { global: {} }
    });
    const workloadRequest = createWorkloadRequest({
      workloadId: "audit_mutations_workload",
      placementId: placement.placementId,
      appId: "audit_mutations_app",
      mode: "finite"
    });
    const workload = await declareWorkload(workloadRequest);
    const updatedWorkload = await declareWorkload({
      ...workloadRequest,
      expectedRevision: workload.revision,
      declaration: {
        ...workloadRequest.declaration!,
        resources: {
          cpuMillis: 100,
          memoryBytes: 64n * 1_024n * 1_024n
        }
      }
    });
    await waitForReadyWorkload(
      updatedWorkload.workloadId,
      updatedWorkload.revision);
    const run = await createRun(
      "audit_mutations_run",
      updatedWorkload.workloadId);
    const cancelled = await cancelRun(run.runId);

    const events = (await context.auditd.readEvents()).slice(baseline);
    assert.equal(events.length, 6);
    assert.deepEqual(
      events.map((event) => [
        event.detailKind,
        "action" in event ? event.action : undefined
      ]),
      [
        ["placement_mutation", "declared"],
        ["placement_mutation", "updated"],
        ["workload_mutation", "declared"],
        ["workload_mutation", "updated"],
        ["run_mutation", "created"],
        ["run_mutation", "cancellation_requested"]
      ]);

    const placementEvent = events[1]!;
    assert.equal(placementEvent.detailKind, "placement_mutation");
    if (placementEvent.detailKind === "placement_mutation") {
      assert.equal(placementEvent.placementId, placement.placementId);
      assert.equal(placementEvent.placementRevision,
        updatedPlacement.revision);
      assert.deepEqual(placementEvent.target, { kind: "global" });
      assert.deepEqual(placementEvent.partition, { kind: "global" });
    }
    const workloadEvent = events[3]!;
    assert.equal(workloadEvent.detailKind, "workload_mutation");
    if (workloadEvent.detailKind === "workload_mutation") {
      assert.equal(workloadEvent.workloadId, workload.workloadId);
      assert.equal(workloadEvent.workloadRevision,
        updatedWorkload.revision);
      assert.equal(workloadEvent.appId, "audit_mutations_app");
      assert.equal(workloadEvent.componentId, "finite");
    }
    const runEvent = events[5]!;
    assert.equal(runEvent.detailKind, "run_mutation");
    if (runEvent.detailKind === "run_mutation") {
      assert.equal(runEvent.runId, run.runId);
      assert.equal(runEvent.runRevision, cancelled.revision);
      assert.equal(runEvent.configuredActorPrincipalId, undefined);
    }
    for (const event of events) {
      assert.deepEqual(event.attribution, {
        kind: "operator",
        operatorCommonName: context.operatorSubject
      });
      assert.match(event.sourceEventId, /^evt_[0-9a-f]{32}$/u);
      assert.match(event.traceId, /^[0-9a-f]{32}$/u);
      assert.match(event.spanId, /^[0-9a-f]{16}$/u);
      assert.ok(Number.isFinite(Date.parse(event.occurredAt)));
    }
  });

test("records capability actor and attached-account audit attribution",
  async () => {
    const context = getExecdTestContext();
    const root = await declarePlacement(createPlacementRequest({
      placementId: "audit_capability_root",
      target: { global: {} }
    }));
    const baseline = (await context.auditd.readEvents()).length;
    const traceId = "0123456789abcdef0123456789abcdef";
    const metadata = createCapabilityMetadata(context, {
      tokenId: "execd-audit-capability"
    });
    metadata.set(
      "traceparent",
      `00-${traceId}-0123456789abcdef-01`);
    const placement = await declarePlacement(
      createPlacementRequest({
        placementId: "audit_capability_tenant",
        target: { tenant: { tenantId: "tenant-a" } },
        parentPlacementId: root.placementId
      }),
      metadata,
      context.capabilityClient);

    const event = (await context.auditd.readEvents())[baseline];
    assert.equal(event?.detailKind, "placement_mutation");
    assert.deepEqual(event?.attribution, {
      kind: "invocation",
      actorPrincipalId: "user:alice",
      attachedAccountPrincipalId: "user:alice",
      workloadSubject: context.capabilityWorkload.callerSubject
    });
    assert.deepEqual(event?.partition, {
      kind: "tenant",
      tenantId: "tenant-a"
    });
    assert.equal(
      event?.detailKind === "placement_mutation"
        ? event.placementId
        : undefined,
      placement.placementId);
    await waitForExport(
      getExecdTestSuite().collector.tracesPath,
      (value) => {
        const spans = findSpansForTrace(value, traceId);
        const server = spans.find(
          (span) => span.name === "execd.DeclarePlacement");
        const policy = spans.find(
          (span) => span.name === "execd.CheckAccess");
        return typeof server?.spanId === "string"
          && policy?.parentSpanId === server.spanId
          && readSpanAttribute(policy, "ctlflow.outcome") === "OK"
          && readSpanAttribute(policy, "ctlflow.decision") === "allow";
      });
  });

test("does not audit reads, replays, denials, or reconciliation",
  async () => {
    const context = getExecdTestContext();
    const placementRequest = createPlacementRequest({
      placementId: "audit_negative_placement",
      target: { global: {} }
    });
    const placement = await declarePlacement(placementRequest);
    await declareTestApp(context.pkgd.client, {
      appId: "audit_negative_app",
      placementId: placement.placementId,
      scope: { global: {} }
    });
    const workloadRequest = createWorkloadRequest({
      workloadId: "audit_negative_workload",
      placementId: placement.placementId,
      appId: "audit_negative_app",
      mode: "finite"
    });
    const workload = await declareWorkload(workloadRequest);
    await waitForReadyWorkload(
      workload.workloadId,
      workload.revision);
    const run = await createRun(
      "audit_negative_run",
      workload.workloadId);
    await cancelRun(run.runId);
    const baseline = (await context.auditd.readEvents()).length;

    await declarePlacement(placementRequest);
    await declareWorkload(workloadRequest);
    await createRun(run.runId, workload.workloadId);
    await cancelRun(run.runId);
    await getPlacement(placement.placementId);
    await getWorkload(workload.workloadId);
    await getRun(run.runId);
    await listAll(placement, workload);
    await assert.rejects(
      declarePlacement(createPlacementRequest({
        placementId: "Invalid",
        target: { global: {} }
      })),
      matchGrpcStatus(status.INVALID_ARGUMENT));
    await waitFor(
      async () => await getRun(run.runId),
      (value) => value.phase === RunPhase.RUN_PHASE_CANCELLED);
    assert.equal(
      (await context.auditd.readEvents()).length,
      baseline);
  });

test("reports audit failure after commit without replay delivery",
  async () => {
    const context = getExecdTestContext();
    const request = createPlacementRequest({
      placementId: "audit_failure_placement",
      target: { global: {} }
    });
    const baseline = (await context.auditd.readEvents()).length;
    await context.auditd.setMode("unavailable");
    try {
      await assert.rejects(
        declarePlacement(request),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.auditd.setMode("available");
    }
    assert.equal(
      (await getPlacement(request.placementId)).placementId,
      request.placementId);
    assert.equal(
      (await context.auditd.readEvents()).length,
      baseline);
    assert.equal(
      (await declarePlacement(request)).placementId,
      request.placementId);
    assert.equal(
      (await context.auditd.readEvents()).length,
      baseline);
  });

test("exports correlated and redacted execution telemetry", async () => {
  const context = getExecdTestContext();
  const suite = getExecdTestSuite();
  const placement = await declarePlacement(createPlacementRequest({
    placementId: "telemetry_placement",
    target: { global: {} }
  }));
  await declareTestApp(context.pkgd.client, {
    appId: "telemetry_app",
    placementId: placement.placementId,
    scope: { global: {} }
  });
  const traceId = "1234567890abcdef1234567890abcdef";
  const metadata = new Metadata();
  metadata.set("traceparent", `00-${traceId}-1234567890abcdef-01`);
  const request = createWorkloadRequest({
    workloadId: "telemetry_workload",
    placementId: placement.placementId,
    appId: "telemetry_app",
    mode: "continuous"
  });
  const workload = await declareWorkload(request, metadata);
  await waitForReadyWorkload(
    workload.workloadId,
    workload.revision);

  await waitForExport(
    suite.collector.tracesPath,
    (value) => {
      const spans = findSpansForTrace(value, traceId);
      const server = spans.find(
        (span) => span.name === "execd.DeclareWorkload");
      const database = spans.find(
        (span) => span.name === "execd.db.declare_workload");
      const getApp = spans.find(
        (span) => span.name === "execd.GetApp");
      const getPackage = spans.find(
        (span) => span.name === "execd.GetPackage");
      const audit = spans.find(
        (span) => span.name === "execd.RecordAuditBatch");
      return typeof server?.spanId === "string"
        && database?.parentSpanId === server.spanId
        && getApp?.parentSpanId === server.spanId
        && getPackage?.parentSpanId === server.spanId
        && audit?.parentSpanId === server.spanId;
    });
  await waitForExport(
    suite.collector.tracesPath,
    (value) => value.includes("\"execd.kubernetes."));
  await waitForExport(
    suite.collector.metricsPath,
    (value) =>
      value.includes("ctlflow.execd.requests")
      && value.includes("ctlflow.execd.duration"));
  await waitForExport(
    suite.collector.logsPath,
    (value) => hasOperationLog(value, {
      operation: "DeclareWorkload",
      outcome: "OK",
      traceId
    }));

  const exports = await readAllExports(suite.collector);
  for (const sensitive of [
    "https://packages.example/package.telemetry.app",
    "{\"engine\":\"postgresql\"}",
    context.execdWorkload.callerToken,
    context.capabilityWorkload.callerToken
  ]) {
    assert.equal(exports.includes(sensitive), false);
  }
  const malformedParent = new Metadata();
  malformedParent.set("traceparent", "not-a-traceparent");
  assert.equal(
    (await getWorkload(request.workloadId, malformedParent)).workloadId,
    request.workloadId);
});

test("telemetry outage is bounded and does not change domain results",
  async () => {
    const suite = getExecdTestSuite();
    await suite.collector.suspend();
    try {
      const started = performance.now();
      const placement = await getPlacement("telemetry_placement");
      assert.equal(placement.placementId, "telemetry_placement");
      assert.ok(performance.now() - started < 1_800);
    } finally {
      await suite.collector.resume();
    }
  });

async function declarePlacement(
  request: DeclarePlacementRequest,
  metadata?: Metadata,
  client = getExecdTestContext().client
): Promise<Placement> {
  return await callUnary((done) => metadata === undefined
    ? client.declarePlacement(request, done)
    : client.declarePlacement(request, metadata, done));
}

async function getPlacement(
  placementId: string
): Promise<Placement> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.getPlacement({ placementId }, done));
}

async function declareWorkload(
  request: DeclareWorkloadRequest,
  metadata?: Metadata
): Promise<Workload> {
  const context = getExecdTestContext();
  return await callUnary((done) => metadata === undefined
    ? context.client.declareWorkload(request, done)
    : context.client.declareWorkload(request, metadata, done));
}

async function getWorkload(
  workloadId: string,
  metadata?: Metadata
): Promise<Workload> {
  const context = getExecdTestContext();
  return await callUnary((done) => metadata === undefined
    ? context.client.getWorkload({ workloadId }, done)
    : context.client.getWorkload({ workloadId }, metadata, done));
}

async function waitForReadyWorkload(
  workloadId: string,
  revision: bigint
): Promise<Workload> {
  return await waitFor(
    async () => await getWorkload(workloadId),
    (value) =>
      value.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_READY
      && value.realization.observedRevision === revision);
}

async function createRun(
  runId: string,
  workloadId: string
): Promise<Run> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.createRun({ runId, workloadId }, done));
}

async function getRun(runId: string): Promise<Run> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.getRun({ runId }, done));
}

async function cancelRun(runId: string): Promise<Run> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.cancelRun({ runId }, done));
}

async function listAll(
  placement: Placement,
  workload: Workload
): Promise<void> {
  const context = getExecdTestContext();
  await callUnary<ListPlacementsResponse>((done) =>
    context.client.listPlacements({
      target: placement.target,
      pageSize: 100,
      afterPlacementId: undefined
    }, done));
  await callUnary<ListWorkloadsResponse>((done) =>
    context.client.listWorkloads({
      placementId: placement.placementId,
      pageSize: 100,
      afterWorkloadId: undefined
    }, done));
  await callUnary<ListRunsResponse>((done) =>
    context.client.listRuns({
      workloadId: workload.workloadId,
      pageSize: 100,
      afterRunId: undefined
    }, done));
}

function readSpanAttribute(
  span: ReturnType<typeof findSpansForTrace>[number],
  key: string
): unknown {
  return span.attributes
    ?.find((attribute) => attribute.key === key)
    ?.value
    ?.stringValue;
}
