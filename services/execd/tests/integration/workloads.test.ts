import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  DesiredState,
  RealizationPhase,
  type DeclarePlacementRequest,
  type DeclareWorkloadRequest,
  type ListWorkloadsResponse,
  type Placement,
  type Workload
} from "../generated/v1/execd.js";
import {
  getExecdTestContext
} from "../suite/get-execd-test-context.js";
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

test("declares, realizes, reads, and lists both workload modes",
  async () => {
    const context = getExecdTestContext();
    const placement = await declarePlacement(
      createPlacementRequest({
        placementId: "workload_modes_placement",
        target: { global: {} }
      }));
    await declareTestApp(context.pkgd.client, {
      appId: "workload_modes_continuous_app",
      placementId: placement.placementId,
      scope: { global: {} }
    });
    await declareTestApp(context.pkgd.client, {
      appId: "workload_modes_finite_app",
      placementId: placement.placementId,
      scope: { global: {} }
    });

    const continuous = await declareWorkload(
      createWorkloadRequest({
        workloadId: "workload_modes_continuous",
        placementId: placement.placementId,
        appId: "workload_modes_continuous_app",
        mode: "continuous"
      }));
    const finite = await declareWorkload(
      createWorkloadRequest({
        workloadId: "workload_modes_finite",
        placementId: placement.placementId,
        appId: "workload_modes_finite_app",
        mode: "finite"
      }));

    for (const workload of [continuous, finite]) {
      assert.equal(workload.revision, 1n);
      assert.equal(
        (await getWorkload(workload.workloadId)).workloadId,
        workload.workloadId);
      const realized = await waitFor(
        async () => await getWorkload(workload.workloadId),
        (value) =>
          value.realization?.phase
            === RealizationPhase.REALIZATION_PHASE_READY);
      assert.equal(realized.realization?.observedRevision, 1n);
      assert.equal(
        realized.admittedPackageComponent?.packageGeneration,
        1n);
    }

    const first = await callUnary<ListWorkloadsResponse>((done) =>
      context.client.listWorkloads({
        placementId: placement.placementId,
        pageSize: 1,
        afterWorkloadId: undefined
      }, done));
    assert.deepEqual(
      first.workloads.map((item) => item.workloadId),
      ["workload_modes_continuous"]);
    assert.equal(
      first.nextAfterWorkloadId,
      "workload_modes_continuous");
    const second = await callUnary<ListWorkloadsResponse>((done) =>
      context.client.listWorkloads({
        placementId: placement.placementId,
        pageSize: 1,
        afterWorkloadId: first.nextAfterWorkloadId
      }, done));
    assert.deepEqual(
      second.workloads.map((item) => item.workloadId),
      ["workload_modes_finite"]);
    assert.equal(second.nextAfterWorkloadId, undefined);
  });

test("enforces workload revision, identity, and immutable placement",
  async () => {
    const context = getExecdTestContext();
    const firstPlacement = await declarePlacement(
      createPlacementRequest({
        placementId: "workload_revision_placement",
        target: { global: {} }
      }));
    const secondPlacement = await declarePlacement(
      createPlacementRequest({
        placementId: "workload_revision_other_placement",
        target: { global: {} }
      }));
    await declareTestApp(context.pkgd.client, {
      appId: "workload_revision_app",
      placementId: firstPlacement.placementId,
      scope: { global: {} }
    });
    await declareTestApp(context.pkgd.client, {
      appId: "workload_revision_other_app",
      placementId: secondPlacement.placementId,
      scope: { global: {} }
    });
    const request = createWorkloadRequest({
      workloadId: "workload_revision",
      placementId: firstPlacement.placementId,
      appId: "workload_revision_app",
      mode: "continuous"
    });
    const created = await declareWorkload(request);
    const replay = await declareWorkload(request);
    assert.equal(replay.revision, created.revision);
    assert.deepEqual(replay.declaration, created.declaration);

    const update = {
      ...request,
      expectedRevision: 1n,
      declaration: {
        ...request.declaration!,
        desiredState: DesiredState.DESIRED_STATE_SUSPENDED
      }
    };
    const changed = await declareWorkload(update);
    assert.equal(changed.revision, 2n);
    assert.equal(
      changed.declaration?.desiredState,
      DesiredState.DESIRED_STATE_SUSPENDED);
    assert.equal((await declareWorkload(update)).revision, 2n);

    await assert.rejects(
      declareWorkload({
        ...request,
        expectedRevision: 1n
      }),
      matchGrpcStatus(status.ABORTED));
    await assert.rejects(
      declareWorkload(request),
      matchGrpcStatus(status.ALREADY_EXISTS));
    await assert.rejects(
      declareWorkload(createWorkloadRequest({
        workloadId: request.workloadId,
        placementId: secondPlacement.placementId,
        appId: "workload_revision_other_app",
        mode: "continuous",
        expectedRevision: 2n
      })),
      matchGrpcStatus(status.FAILED_PRECONDITION));
  });

test("enforces package scope, component, dependency, and exposure admission",
  async () => {
    const context = getExecdTestContext();
    const globalPlacement = await declarePlacement(
      createPlacementRequest({
        placementId: "workload_admission_global",
        target: { global: {} }
      }));
    const tenantPlacement = await declarePlacement(
      createPlacementRequest({
        placementId: "workload_admission_tenant",
        target: { tenant: { tenantId: "tenant-a" } },
        parentPlacementId: globalPlacement.placementId
      }));
    await declareTestApp(context.pkgd.client, {
      appId: "workload_admission_global_app",
      placementId: globalPlacement.placementId,
      scope: { global: {} }
    });
    await declareTestApp(context.pkgd.client, {
      appId: "workload_admission_tenant_app",
      placementId: tenantPlacement.placementId,
      scope: { tenant: { tenantId: "tenant-a" } }
    });

    await assert.rejects(
      declareWorkload(createWorkloadRequest({
        workloadId: "workload_wrong_scope",
        placementId: globalPlacement.placementId,
        appId: "workload_admission_tenant_app",
        mode: "continuous"
      })),
      matchGrpcStatus(status.NOT_FOUND));
    await assert.rejects(
      declareWorkload(createWorkloadRequest({
        workloadId: "workload_missing_component",
        placementId: globalPlacement.placementId,
        appId: "workload_admission_global_app",
        componentId: "absent",
        mode: "continuous"
      })),
      matchGrpcStatus(status.NOT_FOUND));
    await assert.rejects(
      declareWorkload(createWorkloadRequest({
        workloadId: "workload_missing_dependency",
        placementId: globalPlacement.placementId,
        appId: "workload_admission_global_app",
        componentId: "dependent",
        mode: "continuous"
      })),
      matchGrpcStatus(status.FAILED_PRECONDITION));
    await assert.rejects(
      declareWorkload(createWorkloadRequest({
        workloadId: "workload_global_exposure",
        placementId: globalPlacement.placementId,
        appId: "workload_admission_global_app",
        componentId: "web",
        mode: "continuous",
        interfaceIds: ["http"]
      })),
      matchGrpcStatus(status.FAILED_PRECONDITION));
    await assert.rejects(
      declareWorkload(createWorkloadRequest({
        workloadId: "workload_tenant_without_actor",
        placementId: tenantPlacement.placementId,
        appId: "workload_admission_tenant_app",
        mode: "finite"
      })),
      matchGrpcStatus(status.FAILED_PRECONDITION));
  });

test("rejects malformed, missing, and over-constraint workloads",
  async () => {
    const context = getExecdTestContext();
    const placement = await declarePlacement(
      createPlacementRequest({
        placementId: "workload_validation_placement",
        target: { global: {} }
      }));
    await declareTestApp(context.pkgd.client, {
      appId: "workload_validation_app",
      placementId: placement.placementId,
      scope: { global: {} }
    });
    const base = createWorkloadRequest({
      workloadId: "workload_validation_base",
      placementId: placement.placementId,
      appId: "workload_validation_app",
      mode: "continuous"
    });
    const invalid: DeclareWorkloadRequest[] = [
      { ...base, workloadId: "Invalid" },
      { ...base, workloadId: "workload_missing_declaration",
        declaration: undefined },
      { ...base, workloadId: "workload_zero_revision",
        expectedRevision: 0n }
    ];
    for (const request of invalid) {
      await assert.rejects(
        declareWorkload(request),
        matchGrpcStatus(status.INVALID_ARGUMENT));
    }

    for (const request of [
      createWorkloadRequest({
        workloadId: "workload_excess_cpu",
        placementId: placement.placementId,
        appId: "workload_validation_app",
        mode: "continuous",
        resources: {
          cpuMillis: 1_001,
          memoryBytes: 32n * 1_024n * 1_024n
        }
      }),
      createWorkloadRequest({
        workloadId: "workload_excess_replicas",
        placementId: placement.placementId,
        appId: "workload_validation_app",
        mode: "continuous",
        replicas: 5
      }),
      createWorkloadRequest({
        workloadId: "workload_overlapping_storage",
        placementId: placement.placementId,
        appId: "workload_validation_app",
        mode: "continuous",
        persistentStorage: [
          {
            storageId: "primary",
            mountPath: "/data",
            capacityBytes: 1_024n
          },
          {
            storageId: "nested",
            mountPath: "/data/nested",
            capacityBytes: 1_024n
          }
        ]
      })
    ]) {
      await assert.rejects(
        declareWorkload(request),
        matchGrpcStatus(status.FAILED_PRECONDITION));
    }
    await assert.rejects(
      getWorkload("workload_absent"),
      matchGrpcStatus(status.NOT_FOUND));
    await assert.rejects(
      callUnary((done) => context.client.listWorkloads({
        placementId: placement.placementId,
        pageSize: 101,
        afterWorkloadId: undefined
      }, done)),
      matchGrpcStatus(status.INVALID_ARGUMENT));
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
