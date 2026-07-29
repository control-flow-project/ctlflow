import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  DesiredState,
  RealizationPhase,
  RunPhase,
  RunReason,
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
  getExecdTestSuite
} from "../suite/get-execd-test-suite.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  getPlacementNamespace
} from "../support/kubernetes/get-placement-namespace.js";
import {
  listOwnedKubernetesObjects
} from "../support/kubernetes/list-owned-kubernetes-objects.js";
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

test("propagates suspension and enforces retirement ordering",
  async () => {
    const context = getExecdTestContext();
    const rootRequest = createPlacementRequest({
      placementId: "lifecycle_root",
      target: { global: {} }
    });
    const root = await declarePlacement(rootRequest);
    const tenantRequest = createPlacementRequest({
      placementId: "lifecycle_tenant",
      target: { tenant: { tenantId: "tenant-a" } },
      parentPlacementId: root.placementId
    });
    const tenant = await declarePlacement(tenantRequest);
    await declareTestApp(context.pkgd.client, {
      appId: "lifecycle_continuous_app",
      placementId: tenant.placementId,
      scope: { tenant: { tenantId: "tenant-a" } }
    });
    await declareTestApp(context.pkgd.client, {
      appId: "lifecycle_finite_app",
      placementId: tenant.placementId,
      scope: { tenant: { tenantId: "tenant-a" } }
    });
    const continuousRequest = createWorkloadRequest({
      workloadId: "lifecycle_continuous",
      placementId: tenant.placementId,
      appId: "lifecycle_continuous_app",
      mode: "continuous"
    });
    const finiteRequest = createWorkloadRequest({
      workloadId: "lifecycle_finite",
      placementId: tenant.placementId,
      appId: "lifecycle_finite_app",
      mode: "finite",
      actorPrincipalId: "agent:reviewer"
    });
    const continuous = await declareWorkload(continuousRequest);
    const finite = await declareWorkload(finiteRequest);
    await waitForPlacementPhase(
      tenant.placementId,
      RealizationPhase.REALIZATION_PHASE_READY);
    await waitForWorkloadPhase(
      continuous.workloadId,
      RealizationPhase.REALIZATION_PHASE_READY);
    await waitForWorkloadPhase(
      finite.workloadId,
      RealizationPhase.REALIZATION_PHASE_READY);

    const suspendedRoot = await declarePlacement({
      ...rootRequest,
      expectedRevision: root.revision,
      desiredState: DesiredState.DESIRED_STATE_SUSPENDED
    });
    await waitForPlacementPhase(
      suspendedRoot.placementId,
      RealizationPhase.REALIZATION_PHASE_SUSPENDED);
    await waitForPlacementPhase(
      tenant.placementId,
      RealizationPhase.REALIZATION_PHASE_SUSPENDED);
    await waitForWorkloadPhase(
      continuous.workloadId,
      RealizationPhase.REALIZATION_PHASE_SUSPENDED);
    await waitForWorkloadPhase(
      finite.workloadId,
      RealizationPhase.REALIZATION_PHASE_SUSPENDED);
    await assert.rejects(
      createRun("lifecycle_suspended_run", finite.workloadId),
      matchGrpcStatus(status.FAILED_PRECONDITION));

    await declarePlacement({
      ...rootRequest,
      expectedRevision: suspendedRoot.revision
    });
    await waitForPlacementPhase(
      tenant.placementId,
      RealizationPhase.REALIZATION_PHASE_READY);
    await waitForWorkloadPhase(
      continuous.workloadId,
      RealizationPhase.REALIZATION_PHASE_READY);
    await waitForWorkloadPhase(
      finite.workloadId,
      RealizationPhase.REALIZATION_PHASE_READY);
    const run = await createRun(
      "lifecycle_active_run",
      finite.workloadId);
    await waitForRunPhase(run.runId, RunPhase.RUN_PHASE_RUNNING);

    await assert.rejects(
      declareWorkload({
        ...finiteRequest,
        expectedRevision: finite.revision,
        declaration: {
          ...finiteRequest.declaration!,
          desiredState: DesiredState.DESIRED_STATE_RETIRED
        }
      }),
      matchGrpcStatus(status.FAILED_PRECONDITION));
    await assert.rejects(
      retirePlacement(tenantRequest, tenant.revision),
      matchGrpcStatus(status.FAILED_PRECONDITION));
    await assert.rejects(
      retirePlacement(rootRequest, 3n),
      matchGrpcStatus(status.FAILED_PRECONDITION));

    await cancelRun(run.runId);
    await waitForRunPhase(run.runId, RunPhase.RUN_PHASE_CANCELLED);
    const retiredContinuous = await retireWorkload(
      continuousRequest,
      continuous.revision);
    const retiredFinite = await retireWorkload(
      finiteRequest,
      finite.revision);
    await waitForWorkloadPhase(
      retiredContinuous.workloadId,
      RealizationPhase.REALIZATION_PHASE_RETIRED);
    await waitForWorkloadPhase(
      retiredFinite.workloadId,
      RealizationPhase.REALIZATION_PHASE_RETIRED);
    await assert.rejects(
      declareWorkload({
        ...finiteRequest,
        expectedRevision: retiredFinite.revision
      }),
      matchGrpcStatus(status.FAILED_PRECONDITION));

    const retiredTenant = await retirePlacement(
      tenantRequest,
      tenant.revision);
    await waitForPlacementPhase(
      retiredTenant.placementId,
      RealizationPhase.REALIZATION_PHASE_RETIRED);
    const currentRoot = await getPlacement(root.placementId);
    const retiredRoot = await retirePlacement(
      rootRequest,
      currentRoot.revision);
    await waitForPlacementPhase(
      retiredRoot.placementId,
      RealizationPhase.REALIZATION_PHASE_RETIRED);
    await assert.rejects(
      declarePlacement({
        ...rootRequest,
        expectedRevision: retiredRoot.revision
      }),
      matchGrpcStatus(status.FAILED_PRECONDITION));
  });

test("records successful, failed, and deadline-exceeded Run terminals",
  async () => {
    const context = getExecdTestContext();
    const placement = await declarePlacement(createPlacementRequest({
      placementId: "terminal_placement",
      target: { global: {} }
    }));
    await waitForPlacementPhase(
      placement.placementId,
      RealizationPhase.REALIZATION_PHASE_READY);
    await declareTestApp(context.pkgd.client, {
      appId: "terminal_app",
      placementId: placement.placementId,
      scope: { global: {} }
    });
    const workload = await declareWorkload(createWorkloadRequest({
      workloadId: "terminal_workload",
      placementId: placement.placementId,
      appId: "terminal_app",
      mode: "finite"
    }));
    await waitForWorkloadPhase(
      workload.workloadId,
      RealizationPhase.REALIZATION_PHASE_READY);

    const succeeded = await createRunningRun(
      "terminal_succeeded",
      workload.workloadId);
    const success = await forceRunStatus(succeeded, {
      active: 0,
      failed: 0,
      succeeded: 1,
      completionTime: new Date().toISOString(),
      conditions: [
        {
          type: "SuccessCriteriaMet",
          status: "True"
        },
        {
          type: "Complete",
          status: "True"
        }
      ]
    }, RunPhase.RUN_PHASE_SUCCEEDED);
    assert.equal(success.reason, RunReason.RUN_REASON_NONE);
    assert.equal(success.attemptCount, 1);
    assert.ok(success.startedAt instanceof Date);
    assert.ok(success.completedAt instanceof Date);
    assert.ok(success.createdAt instanceof Date);
    assert.ok(success.startedAt.getTime() >= success.createdAt.getTime());
    assert.ok(
      success.completedAt.getTime() >= success.startedAt.getTime());
    await assertTerminalCancellationRejected(success.runId);

    const failed = await createRunningRun(
      "terminal_failed",
      workload.workloadId);
    const failure = await forceRunStatus(failed, {
      active: 0,
      failed: 1,
      succeeded: 0,
      conditions: [
        {
          type: "FailureTarget",
          status: "True",
          reason: "BackoffLimitExceeded"
        },
        {
          type: "Failed",
          status: "True",
          reason: "BackoffLimitExceeded"
        }
      ]
    }, RunPhase.RUN_PHASE_FAILED);
    assert.equal(
      failure.reason,
      RunReason.RUN_REASON_EXECUTION_FAILED);
    await assertTerminalCancellationRejected(failure.runId);

    const exceeded = await createRunningRun(
      "terminal_deadline",
      workload.workloadId);
    const deadline = await forceRunStatus(exceeded, {
      active: 0,
      failed: 1,
      succeeded: 0,
      conditions: [
        {
          type: "FailureTarget",
          status: "True",
          reason: "DeadlineExceeded"
        },
        {
          type: "Failed",
          status: "True",
          reason: "DeadlineExceeded"
        }
      ]
    }, RunPhase.RUN_PHASE_FAILED);
    assert.equal(
      deadline.reason,
      RunReason.RUN_REASON_DURATION_EXCEEDED);
    await assertTerminalCancellationRejected(deadline.runId);
  });

async function retirePlacement(
  request: DeclarePlacementRequest,
  revision: bigint
): Promise<Placement> {
  return await declarePlacement({
    ...request,
    expectedRevision: revision,
    desiredState: DesiredState.DESIRED_STATE_RETIRED
  });
}

async function retireWorkload(
  request: DeclareWorkloadRequest,
  revision: bigint
): Promise<Workload> {
  return await declareWorkload({
    ...request,
    expectedRevision: revision,
    declaration: {
      ...request.declaration!,
      desiredState: DesiredState.DESIRED_STATE_RETIRED
    }
  });
}

async function createRunningRun(
  runId: string,
  workloadId: string
): Promise<Run> {
  const created = await createRun(runId, workloadId);
  return await waitForRunPhase(
    created.runId,
    RunPhase.RUN_PHASE_RUNNING);
}

async function forceRunStatus(
  run: Run,
  value: Readonly<Record<string, unknown>>,
  phase: RunPhase
): Promise<Run> {
  const suite = getExecdTestSuite();
  const namespace = await getPlacementNamespace(
    suite.kubernetes,
    run.placementId);
  const jobs = await listOwnedKubernetesObjects(
    suite.kubernetes,
    "jobs",
    { "execution.ctlflow.io/run-id": run.runId },
    namespace);
  assert.equal(jobs.length, 1);
  const name = jobs[0]!.metadata.name;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const document = JSON.parse((await suite.kubernetes.runKubectl([
      "get",
      "job",
      name,
      "--namespace",
      namespace,
      "--output=json"
    ])).stdout) as {
      readonly apiVersion: string;
      readonly kind: string;
      readonly metadata: Readonly<Record<string, unknown>>;
      readonly status?: Readonly<Record<string, unknown>>;
    };
    const statusPatch: Record<string, unknown> = {
      ...document.status,
      ...value
    };
    preserveControllerTimestamp(
      statusPatch,
      document.status,
      "startTime");
    preserveControllerTimestamp(
      statusPatch,
      document.status,
      "completionTime");
    try {
      await suite.kubernetes.runKubectl([
        "replace",
        "--raw",
        `/apis/batch/v1/namespaces/${namespace}/jobs/${name}/status`,
        "-f",
        "-"
      ], JSON.stringify({
        apiVersion: document.apiVersion,
        kind: document.kind,
        metadata: document.metadata,
        status: {
          ...statusPatch
        }
      }));
    } catch (error) {
      if (!(error instanceof Error)
          || !error.message.includes("the object has been modified")) {
        throw error;
      }
      await delay(100);
      continue;
    }
    const current = await getRun(run.runId);
    if (current.phase === phase) {
      return current;
    }
    await delay(100);
  }
  throw new Error(`Run ${run.runId} did not reach a terminal phase`);
}

function preserveControllerTimestamp(
  target: Record<string, unknown>,
  current: Readonly<Record<string, unknown>> | undefined,
  property: "startTime" | "completionTime"
): void {
  if (current?.[property] !== undefined) {
    target[property] = current[property];
  }
}

async function assertTerminalCancellationRejected(
  runId: string
): Promise<void> {
  await assert.rejects(
    cancelRun(runId),
    matchGrpcStatus(status.FAILED_PRECONDITION));
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

async function waitForPlacementPhase(
  placementId: string,
  phase: RealizationPhase
): Promise<Placement> {
  return await waitFor(
    async () => await getPlacement(placementId),
    (value) => value.realization?.phase === phase,
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

async function cancelRun(runId: string): Promise<Run> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.cancelRun({ runId }, done));
}
