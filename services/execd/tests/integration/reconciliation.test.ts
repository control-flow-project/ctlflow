import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  RealizationPhase,
  RunPhase,
  type DeclarePlacementRequest,
  type DeclareWorkloadRequest,
  type Placement,
  type Run,
  type Workload
} from "../generated/v1/execd.js";
import {
  getExecdTestContext
} from "../suite/get-execd-test-context.js";
import {
  callUnary
} from "../support/call-unary.js";
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

test("does not rewrite unchanged realization state", async () => {
  const context = getExecdTestContext();
  const placement = await declarePlacement(createPlacementRequest({
    placementId: "reconciliation_stability_placement",
    target: { global: {} }
  }));
  await waitFor(
    async () => await getPlacement(placement.placementId),
    (value) =>
      value.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_READY,
    30_000);
  await declareTestApp(context.pkgd.client, {
    appId: "reconciliation_stability_app",
    placementId: placement.placementId,
    scope: { global: {} }
  });
  const workload = await declareWorkload(createWorkloadRequest({
    workloadId: "reconciliation_stability_workload",
    placementId: placement.placementId,
    appId: "reconciliation_stability_app",
    mode: "finite"
  }));
  await waitFor(
    async () => await getWorkload(workload.workloadId),
    (value) =>
      value.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_READY,
    30_000);
  const run = await createRun(
    "reconciliation_stability_run",
    workload.workloadId);
  await waitFor(
    async () => await getRun(run.runId),
    (value) => value.phase === RunPhase.RUN_PHASE_RUNNING,
    30_000);

  const before = {
    placement: await stableFingerprint(
      async () => placementFingerprint(
        await getPlacement(placement.placementId))),
    workload: await stableFingerprint(
      async () => workloadFingerprint(
        await getWorkload(workload.workloadId))),
    run: await stableFingerprint(
      async () => runFingerprint(await getRun(run.runId)))
  };
  await delay(500);
  assert.deepEqual(
    placementFingerprint(await getPlacement(placement.placementId)),
    before.placement);
  assert.deepEqual(
    workloadFingerprint(await getWorkload(workload.workloadId)),
    before.workload);
  assert.deepEqual(
    runFingerprint(await getRun(run.runId)),
    before.run);
  await cancelRun(run.runId);
});

interface StatusFingerprint {
  readonly revision: bigint;
  readonly statusRevision?: bigint;
  readonly updatedAt: number;
}

async function stableFingerprint(
  read: () => Promise<StatusFingerprint>
): Promise<StatusFingerprint> {
  const deadline = Date.now() + 5_000;
  let previous = await read();
  while (Date.now() < deadline) {
    await delay(250);
    const current = await read();
    if (sameFingerprint(previous, current)) {
      return current;
    }
    previous = current;
  }
  throw new Error("Reconciliation state did not become stable");
}

function sameFingerprint(
  left: StatusFingerprint,
  right: StatusFingerprint
): boolean {
  return left.revision === right.revision
    && left.statusRevision === right.statusRevision
    && left.updatedAt === right.updatedAt;
}

function placementFingerprint(value: Placement): StatusFingerprint {
  assert.ok(value.realization?.updatedAt instanceof Date);
  return {
    revision: value.revision,
    statusRevision: value.realization.statusRevision,
    updatedAt: value.realization.updatedAt.getTime()
  };
}

function workloadFingerprint(value: Workload): StatusFingerprint {
  assert.ok(value.realization?.updatedAt instanceof Date);
  return {
    revision: value.revision,
    statusRevision: value.realization.statusRevision,
    updatedAt: value.realization.updatedAt.getTime()
  };
}

function runFingerprint(value: Run): StatusFingerprint {
  assert.ok(value.updatedAt instanceof Date);
  return {
    revision: value.revision,
    updatedAt: value.updatedAt.getTime()
  };
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
