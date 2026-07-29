import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  RealizationPhase,
  RealizationReason,
  RunPhase,
  RunReason,
  type DeclarePlacementRequest,
  type DeclareWorkloadRequest,
  type Placement,
  type Run,
  type Workload
} from "../generated/v1/execd.js";
import type {
  PublishConfigurationResponse
} from "../generated/v1/configd.js";
import {
  getExecdTestContext
} from "../suite/get-execd-test-context.js";
import {
  getExecdTestSuite
} from "../suite/get-execd-test-suite.js";
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
  waitFor
} from "../support/wait-for.js";
import {
  createWorkloadRequest
} from "../support/workloads/create-workload-request.js";

test("rejects and recovers from a Kubernetes ownership collision",
  async () => {
    const suite = getExecdTestSuite();
    const placementId = "failure_ownership_placement";
    const namespace = createPlacementNamespaceName(placementId);
    await suite.kubernetes.runKubectl(
      ["apply", "-f", "-"],
      JSON.stringify({
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: namespace }
      }));

    try {
      const placement = await declarePlacement(
        createPlacementRequest({
          placementId,
          target: { global: {} }
        }));
      const degraded = await waitForPlacement(
        placement.placementId,
        (value) =>
          value.realization?.phase
            === RealizationPhase.REALIZATION_PHASE_DEGRADED
          && value.realization.reason
            === RealizationReason.REALIZATION_REASON_OWNERSHIP_CONFLICT);
      assert.equal(
        degraded.realization?.observedRevision,
        degraded.revision);

      const result = await suite.kubernetes.runKubectl([
        "get",
        "namespace",
        namespace,
        "-o",
        "json"
      ]);
      const document = requireRecord(
        JSON.parse(result.stdout) as unknown,
        "Namespace");
      const metadata = requireRecord(document.metadata, "Namespace metadata");
      const annotations = metadata.annotations === undefined
        ? {}
        : requireRecord(
            metadata.annotations,
            "Namespace annotations");
      assert.equal(
        annotations["execution.ctlflow.io/owner-service"],
        undefined);
      assert.equal(
        annotations["execution.ctlflow.io/placement-id"],
        undefined);
    } finally {
      await suite.kubernetes.runKubectl([
        "delete",
        "namespace",
        namespace,
        "--ignore-not-found=true",
        "--wait=true",
        "--timeout=30s"
      ]);
    }

    const recovered = await waitForPlacement(
      placementId,
      (value) =>
        value.realization?.phase
          === RealizationPhase.REALIZATION_PHASE_READY);
    assert.equal(
      recovered.realization?.observedRevision,
      recovered.revision);
  });

test("degrades and recovers a Workload when Configd is unavailable",
  async () => {
    const context = getExecdTestContext();
    const placement = await createReadyGlobalPlacement(
      "failure_configd_placement");
    const workloadId = "failure_configd_workload";
    const configuration = await callUnary<PublishConfigurationResponse>(
      (done) => context.configd.client.publishConfiguration({
        configurationId: "failure_configd_configuration",
        configurationVersionId: "failure_configd_configuration_v1",
        binding: {
          placement: {
            placementId: placement.placementId,
            global: {}
          },
          consumerId: workloadId,
          purpose: "runtime_config"
        },
        contentJson: Buffer.from('{"mode":"failure-test"}', "utf8")
      }, done));
    await declareTestApp(context.pkgd.client, {
      appId: "failure_configd_app",
      placementId: placement.placementId,
      scope: { global: {} }
    });

    await context.configd.database.connection.schema.renameTable(
      "projections",
      "projections_unavailable");
    try {
      const workload = await declareWorkload(createWorkloadRequest({
        workloadId,
        placementId: placement.placementId,
        appId: "failure_configd_app",
        mode: "finite",
        configdTargets: [{
          purpose: "runtime_config",
          configuration: {
            configurationId:
              configuration.configuration!.configurationId,
            configurationVersionId:
              configuration.version!.configurationVersionId
          }
        }]
      }));
      const degraded = await waitForWorkload(
        workload.workloadId,
        (value) =>
          value.realization?.phase
            === RealizationPhase.REALIZATION_PHASE_DEGRADED
          && value.realization.reason
            === RealizationReason.REALIZATION_REASON_BINDING_UNAVAILABLE);
      assert.equal(
        degraded.realization?.observedRevision,
        degraded.revision);
    } finally {
      await context.configd.database.connection.schema.renameTable(
        "projections_unavailable",
        "projections");
    }

    const recovered = await waitForWorkload(
      workloadId,
      (value) =>
        value.realization?.phase
          === RealizationPhase.REALIZATION_PHASE_READY);
    assert.equal(
      recovered.realization?.observedRevision,
      recovered.revision);
  });

test("keeps a Run pending and recovers when Identityd is unavailable",
  async () => {
    const context = getExecdTestContext();
    const root = await createReadyGlobalPlacement(
      "failure_identity_root");
    const placement = await declarePlacement(createPlacementRequest({
      placementId: "failure_identity_tenant",
      target: { tenant: { tenantId: "tenant-a" } },
      parentPlacementId: root.placementId
    }));
    await waitForPlacement(
      placement.placementId,
      (value) =>
        value.realization?.phase
          === RealizationPhase.REALIZATION_PHASE_READY);
    await declareTestApp(context.pkgd.client, {
      appId: "failure_identity_app",
      placementId: placement.placementId,
      scope: { tenant: { tenantId: "tenant-a" } }
    });
    const workload = await declareWorkload(createWorkloadRequest({
      workloadId: "failure_identity_workload",
      placementId: placement.placementId,
      appId: "failure_identity_app",
      mode: "finite",
      actorPrincipalId: "agent:reviewer"
    }));
    await waitForWorkload(
      workload.workloadId,
      (value) =>
        value.realization?.phase
          === RealizationPhase.REALIZATION_PHASE_READY);

    const runId = "failure_identity_run";
    await context.identityd.setMode("unavailable");
    try {
      await createRun(runId, workload.workloadId);
      const pending = await waitForRun(
        runId,
        (value) =>
          value.phase === RunPhase.RUN_PHASE_PENDING
          && value.reason
            === RunReason.RUN_REASON_INVOCATION_UNAVAILABLE);
      assert.equal(pending.actorPrincipalId, "agent:reviewer");
    } finally {
      await context.identityd.setMode("available");
    }

    const running = await waitForRun(
      runId,
      (value) => value.phase === RunPhase.RUN_PHASE_RUNNING);
    assert.equal(running.reason, RunReason.RUN_REASON_NONE);
    await cancelRun(runId);
    await waitForRun(
      runId,
      (value) => value.phase === RunPhase.RUN_PHASE_CANCELLED);
  });

test("fails synchronously when Pkgd is unavailable",
  async () => {
    const context = getExecdTestContext();
    const placement = await createReadyGlobalPlacement(
      "failure_pkgd_placement");
    await declareTestApp(context.pkgd.client, {
      appId: "failure_pkgd_app",
      placementId: placement.placementId,
      scope: { global: {} }
    });
    const request = createWorkloadRequest({
      workloadId: "failure_pkgd_workload",
      placementId: placement.placementId,
      appId: "failure_pkgd_app",
      mode: "finite"
    });

    await context.pkgd.database.connection.schema.renameTable(
      "apps",
      "apps_unavailable");
    try {
      await assert.rejects(
        declareWorkload(request),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.pkgd.database.connection.schema.renameTable(
        "apps_unavailable",
        "apps");
    }

    const workload = await declareWorkload(request);
    await waitForWorkload(
      workload.workloadId,
      (value) =>
        value.realization?.phase
          === RealizationPhase.REALIZATION_PHASE_READY);
  });

async function createReadyGlobalPlacement(
  placementId: string
): Promise<Placement> {
  const placement = await declarePlacement(createPlacementRequest({
    placementId,
    target: { global: {} }
  }));
  return await waitForPlacement(
    placement.placementId,
    (value) =>
      value.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_READY);
}

async function declarePlacement(
  request: DeclarePlacementRequest
): Promise<Placement> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.declarePlacement(request, done));
}

async function getPlacement(placementId: string): Promise<Placement> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.getPlacement({ placementId }, done));
}

async function waitForPlacement(
  placementId: string,
  predicate: (value: Placement) => boolean
): Promise<Placement> {
  return await waitFor(
    async () => await getPlacement(placementId),
    predicate,
    30_000);
}

async function declareWorkload(
  request: DeclareWorkloadRequest
): Promise<Workload> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.declareWorkload(request, done));
}

async function getWorkload(workloadId: string): Promise<Workload> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.getWorkload({ workloadId }, done));
}

async function waitForWorkload(
  workloadId: string,
  predicate: (value: Workload) => boolean
): Promise<Workload> {
  return await waitFor(
    async () => await getWorkload(workloadId),
    predicate,
    30_000);
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

async function waitForRun(
  runId: string,
  predicate: (value: Run) => boolean
): Promise<Run> {
  return await waitFor(
    async () => await getRun(runId),
    predicate,
    30_000);
}

async function cancelRun(runId: string): Promise<Run> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.cancelRun({ runId }, done));
}

function createPlacementNamespaceName(placementId: string): string {
  const id = Buffer.from(placementId, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(id.byteLength);
  const hash = createHash("sha256")
    .update(
      "ctlflow.execution.v1.PlacementNamespace",
      "ascii")
    .update(Buffer.from([0]))
    .update(length)
    .update(id)
    .digest("hex")
    .slice(0, 32);
  return `plc-${hash}`;
}

function requireRecord(
  value: unknown,
  name: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object"
      || value === null
      || Array.isArray(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value as Readonly<Record<string, unknown>>;
}
