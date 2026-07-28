import assert from "node:assert/strict";
import {
  performance
} from "node:perf_hooks";
import { test } from "node:test";
import {
  Metadata,
  status
} from "@grpc/grpc-js";
import {
  getConfigdTestContext
} from "../suite/get-configd-test-context.js";
import {
  configureCapabilityPolicy
} from "../support/authorization/configure-capability-policy.js";
import {
  createCapabilityMetadata
} from "../support/authorization/create-capability-metadata.js";
import {
  createConfigurationRequest
} from "../support/configurations/create-configuration-request.js";
import {
  publishConfiguration
} from "../support/configurations/publish-configuration.js";
import {
  resolveConfiguration
} from "../support/configurations/resolve-configuration.js";
import {
  provisionProjectionOwners
} from "../support/kubernetes/provision-projection-owners.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  applyProjection
} from "../support/projections/apply-projection.js";
import {
  createProjectionRequest
} from "../support/projections/create-projection-request.js";
import {
  createSecretRequest
} from "../support/secrets/create-secret-request.js";
import {
  publishSecret
} from "../support/secrets/publish-secret.js";
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
  workloadMetadata
} from "../support/workload-metadata.js";

test("records complete publication and projection audit facts", async () => {
  const context = getConfigdTestContext();
  const baseline = (await context.auditd.readEvents()).length;
  const binding = {
    placementId: "audit_projection_placement",
    consumerId: "audit_projection_workload",
    scope: {
      kind: "workspace" as const,
      tenantId: "audit_tenant",
      workspaceId: "audit_workspace"
    }
  };
  await provisionProjectionOwners(
    context.kubernetes,
    binding.placementId,
    binding.consumerId);
  const configuration = createConfigurationRequest({
    configurationId: "audit_configuration",
    ...binding
  });
  const secret = createSecretRequest({
    secretId: "audit_secret",
    purpose: "api_credential",
    ...binding
  });
  await publishConfiguration(context.client, configuration);
  await publishSecret(context.client, secret);
  const projection = await applyProjection(
    context.workloadClient,
    createProjectionRequest({
      configuration: {
        configurationId: configuration.configurationId,
        configurationVersionId:
          configuration.configurationVersionId
      }
    }, binding),
    workloadMetadata(context.execdWorkload.callerToken));

  const events = (await context.auditd.readEvents()).slice(baseline);
  assert.equal(events.length, 3);
  const configurationEvent = events[0]!;
  assert.equal(
    configurationEvent.detailKind,
    "configuration_publication");
  if (configurationEvent.detailKind === "configuration_publication") {
    assert.equal(
      configurationEvent.configurationId,
      configuration.configurationId);
    assert.equal(
      configurationEvent.configurationVersionId,
      configuration.configurationVersionId);
    assert.equal(configurationEvent.identityRevision, 1n);
    assert.equal(configurationEvent.binding.placementId, binding.placementId);
    assert.deepEqual(configurationEvent.partition, {
      kind: "tenant",
      tenantId: "audit_tenant"
    });
  }
  const secretEvent = events[1]!;
  assert.equal(secretEvent.detailKind, "secret_publication");
  if (secretEvent.detailKind === "secret_publication") {
    assert.equal(secretEvent.secretId, secret.secretId);
    assert.equal(secretEvent.secretVersionId, secret.secretVersionId);
    assert.equal(secretEvent.identityRevision, 1n);
  }
  const projectionEvent = events[2]!;
  assert.equal(projectionEvent.detailKind, "projection_mutation");
  if (projectionEvent.detailKind === "projection_mutation") {
    assert.equal(projectionEvent.action, "created");
    assert.equal(projectionEvent.projectionId, projection.projectionId);
    assert.equal(projectionEvent.projectionRevision, 1n);
    assert.deepEqual(projectionEvent.target, {
      kind: "configuration",
      configurationId: configuration.configurationId,
      configurationVersionId:
        configuration.configurationVersionId
    });
    assert.deepEqual(projectionEvent.attribution, {
      kind: "workload",
      workloadSubject: context.execdWorkload.callerSubject
    });
  }
  for (const event of events) {
    assert.match(event.sourceEventId, /^evt_[0-9a-f]{32}$/u);
    assert.match(event.traceId, /^[0-9a-f]{32}$/u);
    assert.match(event.spanId, /^[0-9a-f]{16}$/u);
    assert.ok(Number.isFinite(Date.parse(event.occurredAt)));
  }
});

test("records invocation attribution and correlated policy evidence",
  async () => {
    const context = getConfigdTestContext();
    const tenantId = "audit_capability_tenant";
    const request = createConfigurationRequest({
      configurationId: "audit_capability_configuration",
      scope: { kind: "tenant", tenantId }
    });
    const resourcePath = `/tenants/${tenantId}`
      + `/placements/${request.binding!.placement!.placementId}`
      + `/consumers/${request.binding!.consumerId}`
      + `/purposes/${request.binding!.purpose}`
      + `/configurations/${request.configurationId}`;
    await configureCapabilityPolicy(context, {
      tenantId,
      grants: [{
        subject: { kind: "principal", id: "user:alice" },
        operation: "configurations.publish",
        basePath: resourcePath,
        match: "exact"
      }]
    });
    const traceId = "0123456789abcdef0123456789abcdef";
    const metadata = createCapabilityMetadata(context, {
      tenantId,
      tokenId: "configd-audit-capability"
    });
    metadata.set(
      "traceparent",
      `00-${traceId}-0123456789abcdef-01`);
    const baseline = (await context.auditd.readEvents()).length;
    await publishConfiguration(
      context.workloadClient,
      request,
      metadata);

    const event = (await context.auditd.readEvents())[baseline];
    assert.equal(event?.detailKind, "configuration_publication");
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
          (span) => span.name === "configd.PublishConfiguration");
        const policy = spans.find(
          (span) => span.name === "configd.CheckAccess");
        return typeof server?.spanId === "string"
          && policy?.parentSpanId === server.spanId
          && readSpanAttribute(policy, "ctlflow.outcome") === "OK"
          && readSpanAttribute(policy, "ctlflow.decision") === "allow";
      });
  });

test("does not audit reads, publication replay, or projection reconciliation",
  async () => {
    const context = getConfigdTestContext();
    const binding = {
      placementId: "audit_noop_placement",
      consumerId: "audit_noop_workload"
    };
    await provisionProjectionOwners(
      context.kubernetes,
      binding.placementId,
      binding.consumerId);
    const request = createConfigurationRequest({
      configurationId: "audit_noop_configuration",
      ...binding
    });
    await publishConfiguration(context.client, request);
    const applyRequest = createProjectionRequest({
      configuration: {
        configurationId: request.configurationId,
        configurationVersionId: request.configurationVersionId
      }
    }, binding);
    await applyProjection(
      context.workloadClient,
      applyRequest,
      workloadMetadata(context.execdWorkload.callerToken));
    const baseline = (await context.auditd.readEvents()).length;

    await publishConfiguration(context.client, request);
    await resolveConfiguration(context.client, {
      configurationId: request.configurationId,
      configurationVersionId: request.configurationVersionId,
      binding: request.binding
    });
    await applyProjection(
      context.workloadClient,
      applyRequest,
      workloadMetadata(context.execdWorkload.callerToken));
    assert.equal(
      (await context.auditd.readEvents()).length,
      baseline);
  });

test("reports audit failure after commit without replay redelivery",
  async () => {
    const context = getConfigdTestContext();
    const request = createConfigurationRequest({
      configurationId: "audit_failure_configuration"
    });
    const baseline = (await context.auditd.readEvents()).length;
    await context.auditd.setMode("unavailable");
    try {
      await assert.rejects(
        publishConfiguration(context.client, request),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.auditd.setMode("available");
    }
    assert.equal(
      (await resolveConfiguration(context.client, {
        configurationId: request.configurationId,
        configurationVersionId: request.configurationVersionId,
        binding: request.binding
      })).configuration?.configurationId,
      request.configurationId);
    await publishConfiguration(context.client, request);
    assert.equal(
      (await context.auditd.readEvents()).length,
      baseline);
  });

test("exports correlated redacted RPC, Db, crypto, metrics, and logs",
  async () => {
    const context = getConfigdTestContext();
    const traceId = "1234567890abcdef1234567890abcdef";
    const metadata = new Metadata();
    metadata.set(
      "traceparent",
      `00-${traceId}-1234567890abcdef-01`);
    const material = Buffer.from(
      "telemetry-private-material",
      "utf8");
    const request = createSecretRequest({
      secretId: "telemetry_secret_resource",
      placementId: "telemetry_secret_placement",
      consumerId: "telemetry_secret_consumer",
      purpose: "telemetry_secret_purpose",
      material
    });
    await publishSecret(context.client, request, metadata);

    await waitForExport(
      context.collector.tracesPath,
      (value) => {
        const spans = findSpansForTrace(value, traceId);
        const server = spans.find(
          (span) => span.name === "configd.PublishSecret");
        const database = spans.find(
          (span) => span.name === "configd.db.publish_secret");
        const crypto = spans.find(
          (span) => span.name === "configd.crypto.encrypt_secret");
        const audit = spans.find(
          (span) => span.name === "configd.RecordAuditBatch");
        return typeof server?.spanId === "string"
          && database?.parentSpanId === server.spanId
          && crypto?.parentSpanId === database?.spanId
          && audit?.parentSpanId === server.spanId;
      });
    await waitForExport(
      context.collector.metricsPath,
      (value) =>
        value.includes("ctlflow.configd.requests")
        && value.includes("ctlflow.configd.duration"));
    await waitForExport(
      context.collector.logsPath,
      (value) => hasOperationLog(value, {
        operation: "PublishSecret",
        outcome: "OK",
        traceId
      }));
    const exports = await readAllExports(context.collector);
    for (const sensitive of [
      request.secretId,
      request.secretVersionId,
      request.binding!.placement!.placementId,
      request.binding!.consumerId,
      request.binding!.purpose,
      material.toString("utf8")
    ]) {
      assert.equal(exports.includes(sensitive), false);
    }
  });

test("records cancellation for an in-flight database operation", async () => {
  const context = getConfigdTestContext();
  const tenantId = "cancel_tenant";
  const request = createConfigurationRequest({
    configurationId: "cancel_configuration",
    scope: { kind: "tenant", tenantId }
  });
  await publishConfiguration(context.client, request);
  const traceId = "abcdef1234567890abcdef1234567890";
  await configureCapabilityPolicy(context, {
    tenantId,
    grants: [{
      subject: { kind: "principal", id: "user:alice" },
      operation: "configurations.read",
      basePath: `/tenants/${tenantId}`
        + `/placements/${request.binding!.placement!.placementId}`
        + `/consumers/${request.binding!.consumerId}`
        + `/purposes/${request.binding!.purpose}`
        + `/configurations/${request.configurationId}`,
      match: "exact"
    }]
  });
  const metadata = createCapabilityMetadata(context, {
    tenantId,
    tokenId: "configd-cancellation"
  });
  metadata.set(
    "traceparent",
    `00-${traceId}-abcdef1234567890-01`);
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  let cancelCall: (() => void) | undefined;
  const blocked = new Promise<never>((_resolve, reject) => {
    const call = context.workloadClient.resolveConfiguration(
      {
        configurationId: request.configurationId,
        configurationVersionId: request.configurationVersionId,
        binding: request.binding
      },
      metadata,
      (error) => {
        reject(error ?? new Error("Cancelled RPC returned no error"));
      });
    call.on("error", () => undefined);
    cancelCall = () => call.cancel();
  });
  try {
    await waitForExport(
      context.collector.tracesPath,
      (value) => findSpansForTrace(value, traceId)
        .some((span) => span.name === "policyd.CheckAccess"));
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
      operation: "ResolveConfiguration",
      outcome: "CANCELLED",
      traceId
    }));
});

test("honors an in-flight database operation deadline", async () => {
  const context = getConfigdTestContext();
  const request = createConfigurationRequest({
    configurationId: "deadline_configuration"
  });
  await publishConfiguration(context.client, request);
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  const blocked = new Promise<never>((_resolve, reject) => {
    const call = context.client.resolveConfiguration(
      {
        configurationId: request.configurationId,
        configurationVersionId: request.configurationVersionId,
        binding: request.binding
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
    const context = getConfigdTestContext();
    const request = createConfigurationRequest({
      configurationId: "telemetry_outage_configuration"
    });
    await publishConfiguration(context.client, request);
    await context.collector.suspend();
    try {
      const started = performance.now();
      const loaded = await resolveConfiguration(context.client, {
        configurationId: request.configurationId,
        configurationVersionId: request.configurationVersionId,
        binding: request.binding
      });
      assert.equal(
        loaded.configuration?.configurationId,
        request.configurationId);
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
