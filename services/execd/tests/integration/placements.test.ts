import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  DesiredState,
  RealizationPhase,
  WorkloadMode,
  type DeclarePlacementRequest,
  type ListPlacementsResponse,
  type Placement
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
  createPlacementRequest
} from "../support/placements/create-placement-request.js";
import {
  waitFor
} from "../support/wait-for.js";

test("declares and reads the four placement target levels", async () => {
  const context = getExecdTestContext();
  const global = await declare(createPlacementRequest({
    placementId: "placement_levels_global",
    target: { global: {} }
  }));
  const tenant = await declare(createPlacementRequest({
    placementId: "placement_levels_tenant",
    target: { tenant: { tenantId: "tenant-a" } },
    parentPlacementId: global.placementId
  }));
  const workspace = await declare(createPlacementRequest({
    placementId: "placement_levels_workspace",
    target: {
      workspace: {
        tenantId: "tenant-a",
        workspaceId: "workspace-a"
      }
    },
    parentPlacementId: tenant.placementId
  }));
  const user = await declare(createPlacementRequest({
    placementId: "placement_levels_user",
    target: {
      user: {
        tenantId: "tenant-a",
        accountPrincipalId: "user:alice"
      }
    },
    parentPlacementId: tenant.placementId
  }));

  for (const placement of [global, tenant, workspace, user]) {
    assert.equal(placement.revision, 1n);
    assert.equal(
      (await get(placement.placementId)).placementId,
      placement.placementId);
    const realized = await waitFor(
      async () => await get(placement.placementId),
      (value) =>
        value.realization?.phase
          === RealizationPhase.REALIZATION_PHASE_READY);
    assert.equal(realized.realization?.observedRevision, 1n);
  }
  assert.deepEqual(global.target?.global, {});
  assert.deepEqual(
    tenant.target?.tenant,
    { tenantId: "tenant-a" });
  assert.deepEqual(
    workspace.target?.workspace,
    {
      tenantId: "tenant-a",
      workspaceId: "workspace-a"
    });
  assert.deepEqual(
    user.target?.user,
    {
      tenantId: "tenant-a",
      accountPrincipalId: "user:alice"
    });

  async function declare(
    request: DeclarePlacementRequest
  ): Promise<Placement> {
    return await callUnary((done) =>
      context.client.declarePlacement(request, done));
  }

  async function get(placementId: string): Promise<Placement> {
    return await callUnary((done) =>
      context.client.getPlacement({ placementId }, done));
  }
});

test("lists placements with stateless immutable-id pagination", async () => {
  const context = getExecdTestContext();
  for (const placementId of [
    "zz_placement_page_0",
    "zz_placement_page_1",
    "zz_placement_page_2",
    "zz_placement_page_3"
  ]) {
    await callUnary((done) => context.client.declarePlacement(
      createPlacementRequest({
        placementId,
        target: { global: {} }
      }),
      done));
  }

  const first = await callUnary<ListPlacementsResponse>((done) =>
    context.client.listPlacements({
      target: { global: {} },
      pageSize: 2,
      afterPlacementId: "zz_placement_page_0"
    }, done));
  assert.deepEqual(
    first.placements.map((item) => item.placementId),
    ["zz_placement_page_1", "zz_placement_page_2"]);
  assert.equal(first.nextAfterPlacementId, "zz_placement_page_2");

  const second = await callUnary<ListPlacementsResponse>((done) =>
    context.client.listPlacements({
      target: { global: {} },
      pageSize: 2,
      afterPlacementId: first.nextAfterPlacementId
    }, done));
  assert.deepEqual(
    second.placements.map((item) => item.placementId),
    ["zz_placement_page_3"]);
  assert.equal(second.nextAfterPlacementId, undefined);
});

test("enforces placement revision and identity idempotency", async () => {
  const context = getExecdTestContext();
  const request = createPlacementRequest({
    placementId: "placement_revision",
    target: { global: {} }
  });
  const created = await callUnary<Placement>((done) =>
    context.client.declarePlacement(request, done));
  assert.deepEqual(
    await callUnary((done) =>
      context.client.declarePlacement(request, done)),
    created);

  const update = {
    ...request,
    desiredState: DesiredState.DESIRED_STATE_SUSPENDED,
    expectedRevision: 1n
  };
  const changed = await callUnary<Placement>((done) =>
    context.client.declarePlacement(update, done));
  assert.equal(changed.revision, 2n);
  assert.equal(
    changed.desiredState,
    DesiredState.DESIRED_STATE_SUSPENDED);
  assert.deepEqual(
    await callUnary((done) =>
      context.client.declarePlacement(update, done)),
    changed);

  await assert.rejects(
    callUnary((done) => context.client.declarePlacement({
      ...request,
      expectedRevision: 1n
    }, done)),
    matchGrpcStatus(status.ABORTED));
  await assert.rejects(
    callUnary((done) =>
      context.client.declarePlacement(request, done)),
    matchGrpcStatus(status.ALREADY_EXISTS));
  await assert.rejects(
    callUnary((done) => context.client.declarePlacement({
      ...request,
      target: { tenant: { tenantId: "tenant-a" } },
      parentPlacementId: "placement_levels_global",
      expectedRevision: 2n
    }, done)),
    matchGrpcStatus(status.FAILED_PRECONDITION));
});

test("rejects invalid placement hierarchy and widening constraints",
  async () => {
    const context = getExecdTestContext();
    const parent = await callUnary<Placement>((done) =>
      context.client.declarePlacement(
        createPlacementRequest({
          placementId: "placement_parent_narrow",
          target: { global: {} },
          constraints: {
            admittedModes: [
              WorkloadMode.WORKLOAD_MODE_FINITE
            ],
            maxReplicasPerContinuousWorkload: 1,
            maxRunDurationSeconds: 60n,
            maxRunAttempts: 1,
            maxResourcesPerExecution: {
              cpuMillis: 100,
              memoryBytes: 32n * 1_024n * 1_024n
            },
            maxPersistentStorageBytesPerWorkload: 1_024n,
            dependencyProvisioners: []
          }
        }),
        done));

    for (const request of [
      createPlacementRequest({
        placementId: "placement_missing_parent",
        target: { tenant: { tenantId: "tenant-a" } }
      }),
      createPlacementRequest({
        placementId: "placement_skipped_parent",
        target: {
          workspace: {
            tenantId: "tenant-a",
            workspaceId: "workspace-b"
          }
        },
        parentPlacementId: parent.placementId
      }),
      createPlacementRequest({
        placementId: "placement_wider_child",
        target: { tenant: { tenantId: "tenant-a" } },
        parentPlacementId: parent.placementId
      }),
      createPlacementRequest({
        placementId: "placement_global_parent",
        target: { global: {} },
        parentPlacementId: "placement_levels_global"
      })
    ]) {
      await assert.rejects(
        callUnary((done) =>
          context.client.declarePlacement(request, done)),
        matchGrpcStatus(status.FAILED_PRECONDITION));
    }
  });

test("rejects malformed placements and missing placement reads",
  async () => {
    const context = getExecdTestContext();
    for (const request of [
      createPlacementRequest({
        placementId: "Invalid",
        target: { global: {} }
      }),
      {
        ...createPlacementRequest({
          placementId: "placement_without_target",
          target: { global: {} }
        }),
        target: undefined
      },
      {
        ...createPlacementRequest({
          placementId: "placement_zero_revision",
          target: { global: {} }
        }),
        expectedRevision: 0n
      }
    ]) {
      await assert.rejects(
        callUnary((done) =>
          context.client.declarePlacement(request, done)),
        matchGrpcStatus(status.INVALID_ARGUMENT));
    }
    await assert.rejects(
      callUnary((done) => context.client.getPlacement({
        placementId: "placement_absent"
      }, done)),
      matchGrpcStatus(status.NOT_FOUND));
    await assert.rejects(
      callUnary((done) => context.client.listPlacements({
        target: { global: {} },
        pageSize: 101,
        afterPlacementId: undefined
      }, done)),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  });
