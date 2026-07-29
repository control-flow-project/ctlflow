import assert from "node:assert/strict";
import {
  setTimeout as delay
} from "node:timers/promises";
import { test } from "node:test";
import {
  status,
  type ClientUnaryCall,
  type ServiceError
} from "@grpc/grpc-js";
import type {
  DeclarePlacementRequest,
  DeclareWorkloadRequest,
  Run,
  Workload
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
  waitFor
} from "../support/wait-for.js";
import {
  createWorkloadRequest
} from "../support/workloads/create-workload-request.js";
import {
  RealizationPhase,
  RunPhase
} from "../generated/v1/execd.js";

test("all ten RPCs honor in-flight cancellation", async () => {
  const state = await prepareBlockedCallState("cancel");
  let callsSettled = false;
  try {
    await whilePolicyIsBlocked(async () => {
      for (const call of calls(state, false)) {
        await expectCancellation(call);
      }
    });
    await waitForBlockedCalls();
    callsSettled = true;
    await assertNoMutationWasApplied(state);
  } finally {
    if (!callsSettled) {
      await waitForBlockedCalls();
    }
    await cancelAndWait(state.retainedRunId);
  }
});

test("all ten RPCs honor in-flight deadlines", async () => {
  const state = await prepareBlockedCallState("deadline");
  let callsSettled = false;
  try {
    await whilePolicyIsBlocked(async () => {
      for (const call of calls(state, true)) {
        await expectDeadline(call);
      }
    });
    await waitForBlockedCalls();
    callsSettled = true;
    await assertNoMutationWasApplied(state);
  } finally {
    if (!callsSettled) {
      await waitForBlockedCalls();
    }
    await cancelAndWait(state.retainedRunId);
  }
});

interface BlockedCallState {
  readonly placementId: string;
  readonly workloadId: string;
  readonly retainedRunId: string;
  readonly placementDeclaration: DeclarePlacementRequest;
  readonly workloadDeclaration: DeclareWorkloadRequest;
  readonly newRunId: string;
}

async function prepareBlockedCallState(
  suffix: string
): Promise<BlockedCallState> {
  const context = getExecdTestContext();
  const rootPlacementId = `${suffix}_calls_root`;
  await callUnary((done) =>
    context.client.declarePlacement(createPlacementRequest({
      placementId: rootPlacementId,
      target: { global: {} }
    }), done));
  const placementId = `${suffix}_calls_placement`;
  await callUnary((done) =>
    context.client.declarePlacement(createPlacementRequest({
      placementId,
      target: { tenant: { tenantId: "tenant-a" } },
      parentPlacementId: rootPlacementId
    }), done));
  const appId = `${suffix}_calls_app`;
  await declareTestApp(context.pkgd.client, {
    appId,
    placementId,
    scope: { tenant: { tenantId: "tenant-a" } }
  });
  const workloadId = `${suffix}_calls_workload`;
  const retainedDeclaration = createWorkloadRequest({
    workloadId,
    placementId,
    appId,
    mode: "finite",
    actorPrincipalId: "user:alice"
  });
  await callUnary((done) =>
    context.client.declareWorkload(retainedDeclaration, done));
  await waitFor(
    async () => await callUnary<Workload>((done) =>
      context.client.getWorkload({ workloadId }, done)),
    (workload) =>
      workload.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_READY);
  const retainedRunId = `${suffix}_calls_retained_run`;
  await callUnary((done) =>
    context.client.createRun({
      runId: retainedRunId,
      workloadId
    }, done));
  await waitFor(
    async () => await callUnary<Run>((done) =>
      context.client.getRun({ runId: retainedRunId }, done)),
    (run) => run.phase === RunPhase.RUN_PHASE_RUNNING);

  return {
    placementId,
    workloadId,
    retainedRunId,
    placementDeclaration: createPlacementRequest({
      placementId: `${suffix}_calls_new_placement`,
      target: { tenant: { tenantId: "tenant-a" } },
      parentPlacementId: rootPlacementId
    }),
    workloadDeclaration: createWorkloadRequest({
      workloadId: `${suffix}_calls_new_workload`,
      placementId,
      appId,
      mode: "finite"
    }),
    newRunId: `${suffix}_calls_new_run`
  };
}

type StartCall = (
  done: (error: ServiceError | null) => void
) => ClientUnaryCall;

interface ExpectedCall {
  readonly operation: string;
  readonly start: StartCall;
}

function calls(
  state: BlockedCallState,
  withDeadline: boolean
): readonly ExpectedCall[] {
  const context = getExecdTestContext();
  const client = context.capabilityClient;
  const metadata = createCapabilityMetadata(context);
  const options = () => ({
    deadline: Date.now() + 500
  });
  return [
    {
      operation: "DeclarePlacement",
      start: (done) => withDeadline
        ? client.declarePlacement(
            state.placementDeclaration,
            metadata,
            options(),
            done)
        : client.declarePlacement(
            state.placementDeclaration,
            metadata,
            done)
    },
    {
      operation: "GetPlacement",
      start: (done) => withDeadline
        ? client.getPlacement(
            { placementId: state.placementId },
            metadata,
            options(),
            done)
        : client.getPlacement(
            { placementId: state.placementId },
            metadata,
            done)
    },
    {
      operation: "ListPlacements",
      start: (done) => withDeadline
        ? client.listPlacements(
            {
              target: { tenant: { tenantId: "tenant-a" } },
              pageSize: 100,
              afterPlacementId: undefined
            },
            metadata,
            options(),
            done)
        : client.listPlacements(
            {
              target: { tenant: { tenantId: "tenant-a" } },
            pageSize: 100,
              afterPlacementId: undefined
            },
            metadata,
            done)
    },
    {
      operation: "DeclareWorkload",
      start: (done) => withDeadline
        ? client.declareWorkload(
            state.workloadDeclaration,
            metadata,
            options(),
            done)
        : client.declareWorkload(
            state.workloadDeclaration,
            metadata,
            done)
    },
    {
      operation: "GetWorkload",
      start: (done) => withDeadline
        ? client.getWorkload(
            { workloadId: state.workloadId },
            metadata,
            options(),
            done)
        : client.getWorkload(
            { workloadId: state.workloadId },
            metadata,
            done)
    },
    {
      operation: "ListWorkloads",
      start: (done) => withDeadline
        ? client.listWorkloads(
            {
              placementId: state.placementId,
              pageSize: 100,
              afterWorkloadId: undefined
            },
            metadata,
            options(),
            done)
        : client.listWorkloads(
          {
            placementId: state.placementId,
            pageSize: 100,
              afterWorkloadId: undefined
            },
            metadata,
            done)
    },
    {
      operation: "CreateRun",
      start: (done) => withDeadline
        ? client.createRun(
            {
              runId: state.newRunId,
              workloadId: state.workloadId
            },
            metadata,
            options(),
            done)
        : client.createRun(
          {
            runId: state.newRunId,
              workloadId: state.workloadId
            },
            metadata,
            done)
    },
    {
      operation: "GetRun",
      start: (done) => withDeadline
        ? client.getRun(
            { runId: state.retainedRunId },
            metadata,
            options(),
            done)
        : client.getRun(
            { runId: state.retainedRunId },
            metadata,
            done)
    },
    {
      operation: "ListRuns",
      start: (done) => withDeadline
        ? client.listRuns(
            {
              workloadId: state.workloadId,
              pageSize: 100,
              afterRunId: undefined
            },
            metadata,
            options(),
            done)
        : client.listRuns(
            {
              workloadId: state.workloadId,
              pageSize: 100,
              afterRunId: undefined
            },
            metadata,
            done)
    },
    {
      operation: "CancelRun",
      start: (done) => withDeadline
        ? client.cancelRun(
            { runId: state.retainedRunId },
            metadata,
            options(),
            done)
        : client.cancelRun(
            { runId: state.retainedRunId },
            metadata,
            done)
    }
  ];
}

async function expectCancellation(call: ExpectedCall): Promise<void> {
  let unaryCall: ClientUnaryCall | undefined;
  const result = new Promise<never>((_resolve, reject) => {
    unaryCall = call.start((error) => {
      reject(error ?? new Error(
        `${call.operation} returned before cancellation`));
    });
    unaryCall.on("error", () => undefined);
  });
  const rejection = assert.rejects(
    result,
    matchGrpcStatus(status.CANCELLED));
  await delay(50);
  unaryCall?.cancel();
  await rejection;
}

async function expectDeadline(call: ExpectedCall): Promise<void> {
  const result = new Promise<never>((_resolve, reject) => {
    const unaryCall = call.start((error) => {
      reject(error ?? new Error(
        `${call.operation} returned before its deadline`));
    });
    unaryCall.on("error", () => undefined);
  });
  await assert.rejects(
    result,
    matchGrpcStatus(status.DEADLINE_EXCEEDED));
}

async function whilePolicyIsBlocked(
  action: () => Promise<void>
): Promise<void> {
  const policy = getExecdTestSuite().policyd.database;
  await policy.raw("BEGIN EXCLUSIVE");
  try {
    await action();
  } finally {
    await policy.raw("ROLLBACK");
  }
}

async function waitForBlockedCalls(): Promise<void> {
  await delay(2_250);
}

async function assertNoMutationWasApplied(
  state: BlockedCallState
): Promise<void> {
  const context = getExecdTestContext();
  await assert.rejects(
    callUnary((done) =>
      context.client.getPlacement({
        placementId: state.placementDeclaration.placementId
      }, done)),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary((done) =>
      context.client.getWorkload({
        workloadId: state.workloadDeclaration.workloadId
      }, done)),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary((done) =>
      context.client.getRun({ runId: state.newRunId }, done)),
    matchGrpcStatus(status.NOT_FOUND));
  const retained = await callUnary<Run>((done) =>
    context.client.getRun({ runId: state.retainedRunId }, done));
  assert.equal(retained.phase, RunPhase.RUN_PHASE_RUNNING);
}

async function cancelAndWait(runId: string): Promise<void> {
  const context = getExecdTestContext();
  await callUnary((done) =>
    context.client.cancelRun({ runId }, done));
  await waitFor(
    async () => await callUnary<Run>((done) =>
      context.client.getRun({ runId }, done)),
    (run) => run.phase === RunPhase.RUN_PHASE_CANCELLED);
}
