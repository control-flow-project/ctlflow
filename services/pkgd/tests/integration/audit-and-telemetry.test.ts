import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import {
  Metadata,
  status
} from "@grpc/grpc-js";
import type {
  Package
} from "../generated/v1/pkgd.js";
import {
  getPkgdTestContext
} from "../suite/get-pkgd-test-context.js";
import {
  configureCapabilityPolicy
} from "../support/authorization/configure-capability-policy.js";
import {
  createCapabilityMetadata
} from "../support/authorization/create-capability-metadata.js";
import {
  createApp
} from "../support/apps/create-app.js";
import {
  getApp
} from "../support/apps/get-app.js";
import {
  setAppPackageGeneration
} from "../support/apps/set-app-package-generation.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  createPackageRequest
} from "../support/packages/create-package-request.js";
import {
  declarePackage
} from "../support/packages/declare-package.js";
import {
  getPackage
} from "../support/packages/get-package.js";
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

test("records complete Package and App mutation audit events", async () => {
  const context = getPkgdTestContext();
  const baseline = (await context.auditd.readEvents()).length;
  const packageId = "audit_package";
  await declarePackage(context, createPackageRequest({ packageId }));
  const app = await createApp(context.client, {
    appId: "audit_app",
    scope: {
      workspace: {
        tenantId: "audit_tenant",
        workspaceId: "audit_workspace"
      }
    },
    placementId: "audit_placement",
    packageId,
    desiredPackageGeneration: 1n
  });
  await declarePackage(context, createPackageRequest({
    packageId,
    generation: 2n,
    version: "2.0.0"
  }));
  const updated = await setAppPackageGeneration(
    context.client,
    app.appId,
    app.revision,
    2n);

  const events = (await context.auditd.readEvents())
    .slice(baseline);
  assert.equal(events.length, 4);
  const firstPackage = events[0]!;
  assert.equal(firstPackage.detailKind, "package_declaration");
  if (firstPackage.detailKind === "package_declaration") {
    assert.equal(firstPackage.packageId, packageId);
    assert.equal(firstPackage.generation, 1n);
    assert.deepEqual(firstPackage.partition, { kind: "global" });
  }
  const created = events[1]!;
  assert.equal(created.detailKind, "app_mutation");
  if (created.detailKind === "app_mutation") {
    assert.equal(created.action, "created");
    assert.equal(created.appId, app.appId);
    assert.deepEqual(created.scope, {
      kind: "workspace",
      tenantId: "audit_tenant",
      workspaceId: "audit_workspace"
    });
    assert.equal(created.placementId, "audit_placement");
    assert.equal(created.packageId, packageId);
    assert.equal(created.packageGeneration, 1n);
    assert.equal(created.appRevision, 1n);
    assert.deepEqual(created.partition, {
      kind: "tenant",
      tenantId: "audit_tenant"
    });
  }
  const changed = events[3]!;
  assert.equal(changed.detailKind, "app_mutation");
  if (changed.detailKind === "app_mutation") {
    assert.equal(changed.action, "package_generation_changed");
    assert.equal(changed.packageGeneration, 2n);
    assert.equal(changed.appRevision, updated.revision);
  }

  for (const event of events) {
    assert.match(event.sourceEventId, /^evt_[0-9a-f]{32}$/u);
    assert.deepEqual(event.attribution, {
      kind: "operator",
      operatorCommonName: context.operatorSubject
    });
    assert.match(event.traceId, /^[0-9a-f]{32}$/u);
    assert.match(event.spanId, /^[0-9a-f]{16}$/u);
    assert.ok(Number.isFinite(Date.parse(event.occurredAt)));
  }
});

test("records invocation attribution for capability App mutations",
  async () => {
    const context = getPkgdTestContext();
    const packageId = "audit_capability_package";
    const tenantId = "audit_capability_tenant";
    const appId = "audit_capability_app";
    await declarePackage(context, createPackageRequest({ packageId }));
    await configureCapabilityPolicy(context, {
      tenantId,
      grants: [{
        subject: { kind: "principal", id: "user:alice" },
        operation: "apps.create",
        basePath: `/tenants/${tenantId}/apps`,
        match: "exact"
      }]
    });
    const traceId = "0123456789abcdef0123456789abcdef";
    const metadata = createCapabilityMetadata(context, {
      tenantId,
      tokenId: "pkgd-audit-capability"
    });
    metadata.set(
      "traceparent",
      `00-${traceId}-0123456789abcdef-01`);
    const baseline = (await context.auditd.readEvents()).length;
    await createApp(
      context.workloadClient,
      {
        appId,
        scope: { tenant: { tenantId } },
        placementId: "audit_capability_placement",
        packageId,
        desiredPackageGeneration: 1n
      },
      metadata);

    const event = (await context.auditd.readEvents())[baseline];
    assert.equal(event?.detailKind, "app_mutation");
    assert.deepEqual(event?.attribution, {
      kind: "invocation",
      actorPrincipalId: "user:alice",
      attachedAccountPrincipalId: "user:alice",
      workloadSubject: context.capabilityWorkload.callerSubject
    });
    await waitForExport(
      context.collector.tracesPath,
      (value) => {
        const spans = findSpansForTrace(value, traceId);
        const server = spans.find(
          (span) => span.name === "pkgd.CreateApp");
        const policy = spans.find(
          (span) => span.name === "pkgd.CheckAccess");
        return typeof server?.spanId === "string"
          && policy?.parentSpanId === server.spanId
          && readSpanAttribute(policy, "ctlflow.outcome") === "OK"
          && readSpanAttribute(policy, "ctlflow.decision") === "allow";
      });
  });

test("does not audit reads, retries, or no-op App updates", async () => {
  const context = getPkgdTestContext();
  const packageId = "audit_retry_package";
  const request = createPackageRequest({ packageId });
  await declarePackage(context, request);
  const app = await createApp(context.client, {
    appId: "audit_retry_app",
    scope: { global: {} },
    placementId: "audit_retry_placement",
    packageId,
    desiredPackageGeneration: 1n
  });
  const baseline = (await context.auditd.readEvents()).length;

  assert.deepEqual(
    await declarePackage(context, request),
    await getPackage(context.client, packageId, 1n));
  assert.deepEqual(
    await createApp(context.client, {
      appId: app.appId,
      scope: app.scope,
      placementId: app.placementId,
      packageId: app.packageId,
      desiredPackageGeneration: 1n
    }),
    app);
  assert.deepEqual(
    await setAppPackageGeneration(
      context.client,
      app.appId,
      app.revision,
      1n),
    app);

  await getPackage(context.client, packageId, 1n);
  await getApp(context.client, app.appId);
  assert.equal(
    (await context.auditd.readEvents()).length,
    baseline);
});

test("reports audit failure after commit without retry redelivery",
  async () => {
    const context = getPkgdTestContext();
    const request = createPackageRequest({
      packageId: "audit_failure_package"
    });
    const baseline = (await context.auditd.readEvents()).length;

    await context.auditd.setMode("unavailable");
    try {
      await assert.rejects(
        declarePackage(context, request),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.auditd.setMode("available");
    }
    assert.equal(
      (await getPackage(
        context.client,
        request.packageId,
        request.generation)).packageId,
      request.packageId);
    assert.equal(
      (await context.auditd.readEvents()).length,
      baseline);

    assert.equal(
      (await declarePackage(context, request)).packageId,
      request.packageId);
    assert.equal(
      (await context.auditd.readEvents()).length,
      baseline);
  });

test("exports correlated and redacted traces, metrics, and logs", async () => {
  const context = getPkgdTestContext();
  const traceId = "1234567890abcdef1234567890abcdef";
  const metadata = new Metadata();
  metadata.set("traceparent", `00-${traceId}-1234567890abcdef-01`);
  const request = createPackageRequest({
    packageId: "telemetry_package"
  });
  const provenance = request.provenance!;
  provenance.sourceUri =
    "https://secret.example.com/telemetry-package";
  const declared = await callUnary<Package>((done) =>
    context.client.declarePackage(request, metadata, done));
  assert.equal(declared.packageId, request.packageId);

  await waitForExport(
    context.collector.tracesPath,
    (value) => {
      const spans = findSpansForTrace(value, traceId);
      const server = spans.find(
        (span) => span.name === "pkgd.DeclarePackage");
      const database = spans.find(
        (span) => span.name === "pkgd.db.declare_package");
      const audit = spans.find(
        (span) => span.name === "pkgd.RecordAuditBatch");
      return typeof server?.spanId === "string"
        && database?.parentSpanId === server.spanId
        && audit?.parentSpanId === server.spanId;
    });
  await waitForExport(
    context.collector.metricsPath,
    (value) =>
      value.includes("ctlflow.pkgd.requests")
      && value.includes("ctlflow.pkgd.duration"));
  await waitForExport(
    context.collector.logsPath,
    (value) => hasOperationLog(value, {
      operation: "DeclarePackage",
      outcome: "OK",
      traceId
    }));

  const exports = await readAllExports(context.collector);
  for (const secret of [
    request.packageId,
    provenance.sourceUri,
    provenance.sourceDigest,
    request.components[0]!.artifact!.repository,
    request.dependencies[0]!.dependencyType,
    request.dependencies[0]!.options!.canonicalJson.toString("utf8")
  ]) {
    assert.equal(exports.includes(secret), false);
  }

  const malformedParent = new Metadata();
  malformedParent.set("traceparent", "not-a-traceparent");
  assert.equal(
    (await getPackage(
      context.client,
      request.packageId,
      1n,
      malformedParent)).packageId,
    request.packageId);
});

test("records cancellation for an in-flight database operation", async () => {
  const context = getPkgdTestContext();
  const packageId = "cancel_package";
  await declarePackage(context, createPackageRequest({ packageId }));
  const traceId = "abcdef1234567890abcdef1234567890";
  const metadata = new Metadata();
  metadata.set("traceparent", `00-${traceId}-abcdef1234567890-01`);
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  let cancelCall: (() => void) | undefined;
  const blocked = new Promise<never>((_resolve, reject) => {
    const call = context.client.getPackage(
      {
        packageId,
        generation: 1n
      },
      metadata,
      (error) => {
        reject(error ?? new Error("Cancelled RPC returned no error"));
      });
    call.on("error", () => undefined);
    cancelCall = () => call.cancel();
  });
  try {
    await assert.rejects(
      getPackage(context.client, "", 1n),
      matchGrpcStatus(status.INVALID_ARGUMENT));
    assert.ok(cancelCall);
    cancelCall();
    await assert.rejects(
      blocked,
      matchGrpcStatus(status.CANCELLED));
  } finally {
    cancelCall?.();
    await blocked.catch(() => undefined);
    await context.database.connection.raw("ROLLBACK");
  }
  await waitForExport(
    context.collector.logsPath,
    (value) => hasOperationLog(value, {
      operation: "GetPackage",
      outcome: "CANCELLED",
      traceId
    }));
});

test("honors an in-flight database operation deadline", async () => {
  const context = getPkgdTestContext();
  const packageId = "deadline_package";
  await declarePackage(context, createPackageRequest({ packageId }));
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  const blocked = new Promise<never>((_resolve, reject) => {
    const call = context.client.getPackage(
      {
        packageId,
        generation: 1n
      },
      new Metadata(),
      { deadline: Date.now() + 200 },
      (error) => {
        reject(error ?? new Error("Expired RPC returned no error"));
      });
    call.on("error", () => undefined);
  });
  try {
    await assert.rejects(
      blocked,
      matchGrpcStatus(status.DEADLINE_EXCEEDED));
  } finally {
    await blocked.catch(() => undefined);
    await context.database.connection.raw("ROLLBACK");
  }
});

test("telemetry outage is bounded and does not change domain results",
  async () => {
    const context = getPkgdTestContext();
    await context.collector.suspend();
    try {
      const started = performance.now();
      const loaded = await getPackage(
        context.client,
        "telemetry_package",
        1n);
      assert.equal(loaded.packageId, "telemetry_package");
      assert.ok(performance.now() - started < 1_800);
    } finally {
      await context.collector.resume();
    }
  });

function readSpanAttribute(
  span: ReturnType<typeof findSpansForTrace>[number],
  key: string
): unknown {
  return span.attributes
    ?.find((attribute) => attribute.key === key)
    ?.value
    ?.stringValue;
}
