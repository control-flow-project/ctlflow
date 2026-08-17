import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  DesiredState,
  RealizationPhase,
  RunPhase,
  type DeclarePlacementRequest,
  type DeclareWorkloadRequest,
  type Placement,
  type Run,
  type Workload
} from "../generated/v1/execd.js";
import type {
  App
} from "../generated/v1/pkgd.js";
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
  getPlacementNamespace
} from "../support/kubernetes/get-placement-namespace.js";
import {
  listOwnedKubernetesObjects,
  type KubernetesObject
} from "../support/kubernetes/list-owned-kubernetes-objects.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  declareTestApp,
  declareTestPackage
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

const storage = [{
  storageId: "data",
  mountPath: "/data",
  capacityBytes: 1_048_576n
}] as const;

test("keeps one App volume through a generation migration rollout",
  async () => {
    const context = getExecdTestContext();
    const suite = getExecdTestSuite();
    const root = await declarePlacement(createPlacementRequest({
      placementId: "storage_rollout_root",
      target: { global: {} }
    }));
    const placement = await declarePlacement(createPlacementRequest({
      placementId: "storage_rollout_placement",
      target: { tenant: { tenantId: "tenant-a" } },
      parentPlacementId: root.placementId
    }));
    const appId = "a".repeat(64);
    const app = await declareTestApp(context.pkgd.client, {
      appId,
      placementId: placement.placementId,
      scope: { tenant: { tenantId: "tenant-a" } }
    });

    const oldServerRequest = createWorkloadRequest({
      workloadId: "storage_rollout_server_v1",
      placementId: placement.placementId,
      appId,
      mode: "continuous",
      componentId: "web",
      persistentStorage: storage,
      interfaceIds: ["http"]
    });
    const oldServer = await declareWorkload(oldServerRequest);
    await waitForWorkloadPhase(
      oldServer.workloadId,
      RealizationPhase.REALIZATION_PHASE_READY);
    const namespace = await getPlacementNamespace(
      suite.kubernetes,
      placement.placementId);
    const initialClaims = await appStorageClaims(
      namespace,
      appId,
      "data");
    assert.equal(initialClaims.length, 1);
    const claimName = initialClaims[0]!.metadata.name;

    await assert.rejects(
      declareWorkload(createWorkloadRequest({
        workloadId: "storage_rollout_parallel_server_v1",
        placementId: placement.placementId,
        appId,
        mode: "continuous",
        persistentStorage: storage
      })),
      matchGrpcStatus(status.RESOURCE_EXHAUSTED));

    const oldFinite = await declareWorkload(createWorkloadRequest({
      workloadId: "storage_rollout_finite_v1",
      placementId: placement.placementId,
      appId,
      mode: "finite",
      actorPrincipalId: "agent:reviewer",
      persistentStorage: storage
    }));
    await waitForWorkloadPhase(
      oldFinite.workloadId,
      RealizationPhase.REALIZATION_PHASE_READY);
    await assert.rejects(
      createRun("storage_rollout_blocked_run", oldFinite.workloadId),
      matchGrpcStatus(status.RESOURCE_EXHAUSTED));

    const suspendedIntent = await declareWorkload({
      ...oldServerRequest,
      expectedRevision: oldServer.revision,
      declaration: {
        ...oldServerRequest.declaration!,
        desiredState: DesiredState.DESIRED_STATE_SUSPENDED
      }
    });
    await waitForWorkloadPhase(
      oldServer.workloadId,
      RealizationPhase.REALIZATION_PHASE_SUSPENDED);

    const packageId = packageIdFor(appId);
    await declareTestPackage(context.pkgd.client, {
      packageId,
      generation: 2n
    });
    const upgraded = await callUnary<App>((done) =>
      context.pkgd.client.setAppPackageGeneration({
        appId,
        expectedRevision: app.revision,
        desiredPackageGeneration: 2n
      }, done));
    assert.equal(upgraded.desiredPackageGeneration, 2n);

    const migration = await declareWorkload(createWorkloadRequest({
      workloadId: "storage_rollout_migration_v2",
      placementId: placement.placementId,
      appId,
      mode: "finite",
      actorPrincipalId: "agent:reviewer",
      persistentStorage: storage
    }));
    assert.equal(
      migration.admittedPackageComponent?.packageGeneration,
      2n);
    await waitForWorkloadPhase(
      migration.workloadId,
      RealizationPhase.REALIZATION_PHASE_READY);
    const run = await createRun(
      "storage_rollout_migration_run_v2",
      migration.workloadId);
    await waitForRunPhase(run.runId, RunPhase.RUN_PHASE_RUNNING);
    const jobs = await listOwnedKubernetesObjects(
      suite.kubernetes,
      "jobs",
      { "execution.ctlflow.io/run-id": run.runId },
      namespace);
    assert.equal(jobs.length, 1);
    assert.match(JSON.stringify(jobs[0]!.spec),
      new RegExp(escapeRegularExpression(claimName)));

    const successorRequest = createWorkloadRequest({
      workloadId: "storage_rollout_server_v2",
      placementId: placement.placementId,
      appId,
      mode: "continuous",
      componentId: "web",
      persistentStorage: storage,
      interfaceIds: ["http"]
    });
    await assert.rejects(
      declareWorkload(successorRequest),
      matchGrpcStatus(status.RESOURCE_EXHAUSTED));

    await cancelRun(run.runId);
    await waitForRunPhase(run.runId, RunPhase.RUN_PHASE_CANCELLED);
    assert.equal((await listOwnedKubernetesObjects(
      suite.kubernetes,
      "jobs",
      { "execution.ctlflow.io/run-id": run.runId },
      namespace)).length, 0);

    const successor = await declareWorkload(successorRequest);
    assert.equal(
      successor.admittedPackageComponent?.packageGeneration,
      2n);
    await waitForWorkloadPhase(
      successor.workloadId,
      RealizationPhase.REALIZATION_PHASE_READY);
    const deployments = await listOwnedKubernetesObjects(
      suite.kubernetes,
      "deployments",
      { "execution.ctlflow.io/workload-id": successor.workloadId },
      namespace);
    assert.equal(deployments.length, 1);
    assert.match(JSON.stringify(deployments[0]!.spec),
      new RegExp(escapeRegularExpression(claimName)));
    assert.match(
      JSON.stringify(deployments[0]!.spec),
      new RegExp(escapeRegularExpression(
        `"execution.ctlflow.io/app-selector":"${appSelector(appId)}"`)));
    const services = await listOwnedKubernetesObjects(
      suite.kubernetes,
      "services",
      { "execution.ctlflow.io/workload-id": successor.workloadId },
      namespace);
    assert.equal(services.length, 1);
    assert.equal(
      services[0]!.metadata.labels?.["execution.ctlflow.io/app-selector"],
      appSelector(appId));

    const retired = await declareWorkload({
      ...oldServerRequest,
      expectedRevision: suspendedIntent.revision,
      declaration: {
        ...oldServerRequest.declaration!,
        desiredState: DesiredState.DESIRED_STATE_RETIRED
      }
    });
    assert.equal(
      retired.admittedPackageComponent?.packageGeneration,
      1n);
    await waitForWorkloadPhase(
      retired.workloadId,
      RealizationPhase.REALIZATION_PHASE_RETIRED);
    const retainedClaims = await appStorageClaims(
      namespace,
      appId,
      "data");
    assert.deepEqual(
      retainedClaims.map((item) => item.metadata.name),
      [claimName]);
  });

test("isolates App bindings and rejects drift or corrupt ownership",
  async () => {
    const context = getExecdTestContext();
    const suite = getExecdTestSuite();
    const placement = await declarePlacement(createPlacementRequest({
      placementId: "storage_isolation_placement",
      target: { global: {} }
    }));
    const firstAppId = "storage_isolation_first_app";
    const secondAppId = "storage_isolation_second_app";
    for (const appId of [firstAppId, secondAppId]) {
      await declareTestApp(context.pkgd.client, {
        appId,
        placementId: placement.placementId,
        scope: { global: {} }
      });
    }

    const first = await declareWorkload(createWorkloadRequest({
      workloadId: "storage_isolation_first_workload",
      placementId: placement.placementId,
      appId: firstAppId,
      mode: "finite",
      persistentStorage: storage
    }));
    const second = await declareWorkload(createWorkloadRequest({
      workloadId: "storage_isolation_second_workload",
      placementId: placement.placementId,
      appId: secondAppId,
      mode: "finite",
      persistentStorage: storage
    }));
    await waitForWorkloadPhase(
      first.workloadId,
      RealizationPhase.REALIZATION_PHASE_READY);
    await waitForWorkloadPhase(
      second.workloadId,
      RealizationPhase.REALIZATION_PHASE_READY);
    const namespace = await getPlacementNamespace(
      suite.kubernetes,
      placement.placementId);
    const firstClaims = await appStorageClaims(
      namespace,
      firstAppId,
      "data");
    const secondClaims = await appStorageClaims(
      namespace,
      secondAppId,
      "data");
    assert.equal(firstClaims.length, 1);
    assert.equal(secondClaims.length, 1);
    assert.notEqual(
      firstClaims[0]!.metadata.name,
      secondClaims[0]!.metadata.name);

    const concurrentAppId = "storage_isolation_concurrent_app";
    await declareTestApp(context.pkgd.client, {
      appId: concurrentAppId,
      placementId: placement.placementId,
      scope: { global: {} }
    });
    const concurrent = await Promise.allSettled([
      declareWorkload(createWorkloadRequest({
        workloadId: "storage_isolation_concurrent_first",
        placementId: placement.placementId,
        appId: concurrentAppId,
        mode: "continuous",
        persistentStorage: storage
      })),
      declareWorkload(createWorkloadRequest({
        workloadId: "storage_isolation_concurrent_second",
        placementId: placement.placementId,
        appId: concurrentAppId,
        mode: "continuous",
        persistentStorage: storage
      }))
    ]);
    assert.equal(
      concurrent.filter(({ status: state }) => state === "fulfilled").length,
      1);
    const rejected = concurrent.find(({ status: state }) => state === "rejected");
    assert.ok(rejected?.status === "rejected");
    assert.ok(matchGrpcStatus(status.RESOURCE_EXHAUSTED)(rejected.reason));

    await assert.rejects(
      declareWorkload(createWorkloadRequest({
        workloadId: "storage_isolation_resize",
        placementId: placement.placementId,
        appId: firstAppId,
        mode: "finite",
        persistentStorage: [{
          ...storage[0],
          capacityBytes: 2_097_152n
        }]
      })),
      matchGrpcStatus(status.FAILED_PRECONDITION));

    await context.database.connection("workload_storage")
      .where({ workload_id: first.workloadId, storage_id: "data" })
      .update({ app_id: secondAppId });
    try {
      await assert.rejects(
        getWorkload(first.workloadId),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.database.connection("workload_storage")
        .where({ workload_id: first.workloadId, storage_id: "data" })
        .update({ app_id: firstAppId });
    }
    const foreignPlacement = await declarePlacement(createPlacementRequest({
      placementId: "storage_isolation_foreign_placement",
      target: { global: {} }
    }));
    await context.database.connection("app_storage_bindings").insert({
      placement_id: foreignPlacement.placementId,
      app_id: firstAppId,
      storage_id: "data",
      capacity_bytes: Number(storage[0].capacityBytes)
    });
    await context.database.connection("workload_storage")
      .where({ workload_id: first.workloadId, storage_id: "data" })
      .update({ placement_id: foreignPlacement.placementId });
    try {
      await assert.rejects(
        getWorkload(first.workloadId),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.database.connection("workload_storage")
        .where({ workload_id: first.workloadId, storage_id: "data" })
        .update({ placement_id: placement.placementId });
      await context.database.connection("app_storage_bindings")
        .where({
          placement_id: foreignPlacement.placementId,
          app_id: firstAppId,
          storage_id: "data"
        })
        .delete();
    }
    assert.equal(
      (await getWorkload(first.workloadId))
        .declaration?.persistentStorage[0]?.capacityBytes,
      storage[0].capacityBytes);
  });

async function declarePlacement(
  request: DeclarePlacementRequest
): Promise<Placement> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.declarePlacement(request, done));
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

async function waitForWorkloadPhase(
  workloadId: string,
  phase: RealizationPhase
): Promise<Workload> {
  return await waitFor(
    async () => await getWorkload(workloadId),
    (value) => value.realization?.phase === phase,
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

async function cancelRun(runId: string): Promise<Run> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.cancelRun({ runId }, done));
}

async function getRun(runId: string): Promise<Run> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.getRun({ runId }, done));
}

async function waitForRunPhase(
  runId: string,
  phase: RunPhase
): Promise<Run> {
  return await waitFor(
    async () => await getRun(runId),
    (value) => value.phase === phase,
    30_000);
}

async function appStorageClaims(
  namespace: string,
  appId: string,
  storageId: string
): Promise<readonly KubernetesObject[]> {
  return await listOwnedKubernetesObjects(
    getExecdTestSuite().kubernetes,
    "persistentvolumeclaims",
    {
      "execution.ctlflow.io/owner-service": "execd",
      "execution.ctlflow.io/app-id": appId,
      "execution.ctlflow.io/storage-id": storageId
    },
    namespace);
}

function packageIdFor(appId: string): string {
  return `package.${appId.replaceAll("_", ".")}`;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function appSelector(appId: string): string {
  const value = Buffer.from(appId, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.byteLength);
  return createHash("sha256")
    .update("ctlflow.execution.v1.AppSelector", "ascii")
    .update(Buffer.from([0]))
    .update(length)
    .update(value)
    .digest("hex")
    .slice(0, 32);
}
