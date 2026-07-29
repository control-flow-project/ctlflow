import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  RealizationPhase,
  RunPhase,
  RunReason,
  type DeclarePlacementRequest,
  type DeclareWorkloadRequest,
  type ListRunsResponse,
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

test("creates, snapshots, lists, realizes, and cancels global runs",
  async () => {
    const context = getExecdTestContext();
    const placement = await declarePlacement(
      createPlacementRequest({
        placementId: "run_global_placement",
        target: { global: {} }
      }));
    const workload = await createReadyFiniteWorkload({
      placement,
      appId: "run_global_app",
      workloadId: "run_global_workload"
    });

    const first = await createRun(
      "run_global_a",
      workload.workloadId);
    assert.equal(first.workloadRevision, 1n);
    assert.equal(first.placementId, placement.placementId);
    assert.equal(
      first.execution?.admittedPackageComponent?.packageGeneration,
      1n);
    assert.equal(
      (await createRun(
        "run_global_a",
        workload.workloadId)).runId,
      first.runId);
    const second = await createRun(
      "run_global_b",
      workload.workloadId);

    const page = await callUnary<ListRunsResponse>((done) =>
      context.client.listRuns({
        workloadId: workload.workloadId,
        pageSize: 1,
        afterRunId: undefined
      }, done));
    assert.deepEqual(
      page.runs.map((item) => item.runId),
      ["run_global_a"]);
    assert.equal(page.nextAfterRunId, "run_global_a");
    const next = await callUnary<ListRunsResponse>((done) =>
      context.client.listRuns({
        workloadId: workload.workloadId,
        pageSize: 1,
        afterRunId: page.nextAfterRunId
      }, done));
    assert.deepEqual(
      next.runs.map((item) => item.runId),
      ["run_global_b"]);

    const running = await waitForRunPhase(
      first.runId,
      RunPhase.RUN_PHASE_RUNNING);
    assert.ok(running.startedAt instanceof Date);
    assert.ok(running.createdAt instanceof Date);
    assert.ok(
      running.startedAt.getTime() >= running.createdAt.getTime());
    const namespace = await getPlacementNamespace(
      getExecdTestSuite().kubernetes,
      placement.placementId);
    const jobs = await listOwnedKubernetesObjects(
      getExecdTestSuite().kubernetes,
      "jobs",
      {
        "execution.ctlflow.io/run-id": first.runId
      },
      namespace);
    assert.equal(jobs.length, 1);
    assert.match(
      JSON.stringify(jobs[0]!.spec),
      /"automountServiceAccountToken":false/);

    await cancelAndWait(first.runId);
    await cancelAndWait(second.runId);
  });

test("projects a tenant run invocation into only its exact job",
  async () => {
    const root = await declarePlacement(
      createPlacementRequest({
        placementId: "run_invocation_root",
        target: { global: {} }
      }));
    const placement = await declarePlacement(
      createPlacementRequest({
        placementId: "run_invocation_tenant",
        target: { tenant: { tenantId: "tenant-a" } },
        parentPlacementId: root.placementId
      }));
    const workload = await createReadyFiniteWorkload({
      placement,
      appId: "run_invocation_app",
      workloadId: "run_invocation_workload",
      actorPrincipalId: "agent:reviewer",
      scope: { tenant: { tenantId: "tenant-a" } }
    });
    const created = await createRun(
      "run_invocation",
      workload.workloadId);
    assert.equal(created.actorPrincipalId, "agent:reviewer");
    await waitForRunPhase(
      created.runId,
      RunPhase.RUN_PHASE_RUNNING);

    const suite = getExecdTestSuite();
    const namespace = await getPlacementNamespace(
      suite.kubernetes,
      placement.placementId);
    const secrets = await listOwnedKubernetesObjects(
      suite.kubernetes,
      "secrets",
      {
        "execution.ctlflow.io/run-id": created.runId
      },
      namespace);
    assert.equal(secrets.length, 1);
    const jobs = await listOwnedKubernetesObjects(
      suite.kubernetes,
      "jobs",
      {
        "execution.ctlflow.io/run-id": created.runId
      },
      namespace);
    assert.equal(jobs.length, 1);
    assert.match(
      JSON.stringify(jobs[0]!.spec),
      /\/run\/ctlflow\/invocation\/token/);

    await cancelAndWait(created.runId);
  });

test("enforces run identity, readiness, pagination, and immutable snapshots",
  async () => {
    const context = getExecdTestContext();
    const placement = await declarePlacement(
      createPlacementRequest({
        placementId: "run_validation_placement",
        target: { global: {} }
      }));
    const first = await createReadyFiniteWorkload({
      placement,
      appId: "run_validation_first_app",
      workloadId: "run_validation_first"
    });
    const second = await createReadyFiniteWorkload({
      placement,
      appId: "run_validation_second_app",
      workloadId: "run_validation_second"
    });
    await declareTestApp(context.pkgd.client, {
      appId: "run_validation_continuous_app",
      placementId: placement.placementId,
      scope: { global: {} }
    });
    const continuous = await declareWorkload(
      createWorkloadRequest({
        workloadId: "run_validation_continuous",
        placementId: placement.placementId,
        appId: "run_validation_continuous_app",
        mode: "continuous"
      }));
    await waitForWorkloadReady(continuous.workloadId);

    const run = await createRun(
      "run_validation_identity",
      first.workloadId);
    await assert.rejects(
      createRun(run.runId, second.workloadId),
      matchGrpcStatus(status.ALREADY_EXISTS));
    const update = createWorkloadRequest({
      workloadId: first.workloadId,
      placementId: placement.placementId,
      appId: "run_validation_first_app",
      mode: "finite",
      expectedRevision: 1n,
      resources: {
        cpuMillis: 200,
        memoryBytes: 64n * 1_024n * 1_024n
      }
    });
    const changed = await declareWorkload(update);
    assert.equal(changed.revision, 2n);
    const retained = await getRun(run.runId);
    assert.equal(retained.workloadRevision, 1n);
    assert.equal(retained.execution?.resources?.cpuMillis, 100);

    await assert.rejects(
      createRun("Invalid", first.workloadId),
      matchGrpcStatus(status.INVALID_ARGUMENT));
    await assert.rejects(
      createRun("run_missing_workload", "workload_absent"),
      matchGrpcStatus(status.NOT_FOUND));
    await assert.rejects(
      createRun("run_continuous", continuous.workloadId),
      matchGrpcStatus(status.FAILED_PRECONDITION));
    await assert.rejects(
      getRun("run_absent"),
      matchGrpcStatus(status.NOT_FOUND));
    await assert.rejects(
      callUnary((done) => context.client.listRuns({
        workloadId: first.workloadId,
        pageSize: 101,
        afterRunId: undefined
      }, done)),
      matchGrpcStatus(status.INVALID_ARGUMENT));
    await assert.rejects(
      callUnary((done) =>
        context.client.cancelRun({ runId: "run_absent" }, done)),
      matchGrpcStatus(status.NOT_FOUND));

    await cancelAndWait(run.runId);
  });

test("rejects a second run while workload-private storage is occupied",
  async () => {
    const placement = await declarePlacement(
      createPlacementRequest({
        placementId: "run_storage_placement",
        target: { global: {} }
      }));
    const workload = await createReadyFiniteWorkload({
      placement,
      appId: "run_storage_app",
      workloadId: "run_storage_workload",
      persistentStorage: [{
        storageId: "data",
        mountPath: "/data",
        capacityBytes: 1_048_576n
      }]
    });
    const first = await createRun(
      "run_storage_first",
      workload.workloadId);
    await waitForRunPhase(
      first.runId,
      RunPhase.RUN_PHASE_RUNNING);
    await assert.rejects(
      createRun("run_storage_second", workload.workloadId),
      matchGrpcStatus(status.RESOURCE_EXHAUSTED));
    await cancelAndWait(first.runId);
  });

interface ReadyFiniteWorkloadOptions {
  readonly placement: Placement;
  readonly appId: string;
  readonly workloadId: string;
  readonly actorPrincipalId?: string;
  readonly scope?: {
    readonly global?: Record<string, never>;
    readonly tenant?: { readonly tenantId: string };
  };
  readonly persistentStorage?: readonly {
    readonly storageId: string;
    readonly mountPath: string;
    readonly capacityBytes: bigint;
  }[];
}

async function createReadyFiniteWorkload(
  options: ReadyFiniteWorkloadOptions
): Promise<Workload> {
  const context = getExecdTestContext();
  await declareTestApp(context.pkgd.client, {
    appId: options.appId,
    placementId: options.placement.placementId,
    scope: options.scope ?? { global: {} }
  });
  const declared = await declareWorkload(
    createWorkloadRequest({
      workloadId: options.workloadId,
      placementId: options.placement.placementId,
      appId: options.appId,
      mode: "finite",
      ...(options.actorPrincipalId === undefined
        ? {}
        : { actorPrincipalId: options.actorPrincipalId }),
      ...(options.persistentStorage === undefined
        ? {}
        : { persistentStorage: options.persistentStorage })
    }));
  return await waitForWorkloadReady(declared.workloadId);
}

async function waitForWorkloadReady(
  workloadId: string
): Promise<Workload> {
  return await waitFor(
    async () => await getWorkload(workloadId),
    (value) =>
      value.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_READY);
}

async function waitForRunPhase(
  runId: string,
  phase: RunPhase
): Promise<Run> {
  try {
    return await waitFor(
      async () => await getRun(runId),
      (value) => value.phase === phase,
      10_000);
  } catch (error) {
    const current = await getRun(runId);
    const suite = getExecdTestSuite();
    const namespace = await getPlacementNamespace(
      suite.kubernetes,
      current.placementId);
    const jobs = await listOwnedKubernetesObjects(
      suite.kubernetes,
      "jobs",
      {
        "execution.ctlflow.io/run-id": runId
      },
      namespace);
    throw new Error(
      `Run ${runId} did not reach ${RunPhase[phase]}; `
      + `phase=${RunPhase[current.phase]}, `
      + `reason=${RunReason[current.reason]}, `
      + `revision=${String(current.revision)}; `
      + `duration=${String(
        current.execution?.runDurationSeconds)}; `
      + `jobs=${String(jobs.length)}; `
      + `job_status=${JSON.stringify(jobs[0]?.status)}`,
      { cause: error });
  }
}

async function cancelAndWait(runId: string): Promise<Run> {
  const context = getExecdTestContext();
  const current = await getRun(runId);
  const cancellation = await callUnary<Run>((done) =>
    context.client.cancelRun({ runId }, done));
  assert.ok(cancellation.revision >= current.revision);
  assert.ok([
    RunPhase.RUN_PHASE_CANCELLING,
    RunPhase.RUN_PHASE_CANCELLED
  ].includes(cancellation.phase));
  assert.equal(
    (await callUnary<Run>((done) =>
      context.client.cancelRun({ runId }, done))).runId,
    runId);
  const cancelled = await waitForRunPhase(
    runId,
    RunPhase.RUN_PHASE_CANCELLED);
  assert.equal(
    cancelled.reason,
    RunReason.RUN_REASON_CANCEL_REQUESTED);
  return cancelled;
}

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
