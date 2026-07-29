import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status,
  type ClientUnaryCall,
  type Metadata,
  type ServiceError
} from "@grpc/grpc-js";
import {
  RealizationPhase,
  RunPhase,
  type DeclarePlacementRequest,
  type DeclareWorkloadRequest,
  type ExecutionServiceClient,
  type ListPlacementsResponse,
  type ListRunsResponse,
  type ListWorkloadsResponse,
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
  createCapabilityGrants
} from "../support/authorization/create-capability-grants.js";
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
  workloadMetadata
} from "../support/workload-metadata.js";
import {
  createWorkloadRequest
} from "../support/workloads/create-workload-request.js";

test("capability backend calls all ten RPCs in one Tenant fence",
  async () => {
    const context = getExecdTestContext();
    const root = await declarePlacement(
      createPlacementRequest({
        placementId: "security_capability_root",
        target: { global: {} }
      }));
    const metadata = createCapabilityMetadata(context);
    const placementRequest = createPlacementRequest({
      placementId: "security_capability_tenant",
      target: { tenant: { tenantId: "tenant-a" } },
      parentPlacementId: root.placementId
    });
    const placement = await capabilityCall<Placement>(
      context.capabilityClient,
      metadata,
      (client, current, done) =>
        client.declarePlacement(placementRequest, current, done));
    assert.equal(
      (await capabilityCall<Placement>(
        context.capabilityClient,
        metadata,
        (client, current, done) =>
          client.getPlacement({
            placementId: placement.placementId
          }, current, done))).placementId,
      placement.placementId);
    const placements = await capabilityCall<ListPlacementsResponse>(
      context.capabilityClient,
      metadata,
      (client, current, done) =>
        client.listPlacements({
          target: { tenant: { tenantId: "tenant-a" } },
          pageSize: 100,
          afterPlacementId: undefined
        }, current, done));
    assert.ok(
      placements.placements.some(
        (item) => item.placementId === placement.placementId));

    await declareTestApp(context.pkgd.client, {
      appId: "security_capability_app",
      placementId: placement.placementId,
      scope: { tenant: { tenantId: "tenant-a" } }
    });
    const workloadRequest = createWorkloadRequest({
      workloadId: "security_capability_workload",
      placementId: placement.placementId,
      appId: "security_capability_app",
      mode: "finite",
      actorPrincipalId: "agent:reviewer"
    });
    const workload = await capabilityCall<Workload>(
      context.capabilityClient,
      metadata,
      (client, current, done) =>
        client.declareWorkload(workloadRequest, current, done));
    await waitFor(
      async () => await capabilityCall<Workload>(
        context.capabilityClient,
        metadata,
        (client, current, done) =>
          client.getWorkload({
            workloadId: workload.workloadId
          }, current, done)),
      (value) =>
        value.realization?.phase
          === RealizationPhase.REALIZATION_PHASE_READY);
    assert.deepEqual(
      (await capabilityCall<ListWorkloadsResponse>(
        context.capabilityClient,
        metadata,
        (client, current, done) =>
          client.listWorkloads({
            placementId: placement.placementId,
            pageSize: 100,
            afterWorkloadId: undefined
          }, current, done))).workloads.map(
        (item) => item.workloadId),
      [workload.workloadId]);

    const run = await capabilityCall<Run>(
      context.capabilityClient,
      metadata,
      (client, current, done) =>
        client.createRun({
          runId: "security_capability_run",
          workloadId: workload.workloadId
        }, current, done));
    assert.equal(
      (await capabilityCall<Run>(
        context.capabilityClient,
        metadata,
        (client, current, done) =>
          client.getRun({ runId: run.runId }, current, done))).runId,
      run.runId);
    assert.deepEqual(
      (await capabilityCall<ListRunsResponse>(
        context.capabilityClient,
        metadata,
        (client, current, done) =>
          client.listRuns({
            workloadId: workload.workloadId,
            pageSize: 100,
            afterRunId: undefined
          }, current, done))).runs.map((item) => item.runId),
      [run.runId]);
    await capabilityCall<Run>(
      context.capabilityClient,
      metadata,
      (client, current, done) =>
        client.cancelRun({ runId: run.runId }, current, done));
    await waitFor(
      async () => await getRun(run.runId),
      (value) => value.phase === RunPhase.RUN_PHASE_CANCELLED);
  });

test("all ten RPCs reject absent and unadmitted caller identity",
  async () => {
    const fixture = await createSecurityFixture("security_callers");
    const context = getExecdTestContext();
    for (const call of callsForAllRpcs(
      context.capabilityClient,
      fixture)) {
      await assert.rejects(
        call(),
        matchGrpcStatus(status.UNAUTHENTICATED));
    }
    for (const call of callsForAllRpcs(
      context.unadmittedOperatorClient,
      fixture)) {
      await assert.rejects(
        call(),
        matchGrpcStatus(status.PERMISSION_DENIED));
    }
    await cancelRun(fixture.run.runId);
  });

test("capability access fails closed on invocation, target, and policy",
  async () => {
    const fixture = await createSecurityFixture("security_fences");
    const context = getExecdTestContext();
    const suite = getExecdTestSuite();
    const valid = createCapabilityMetadata(context);
    const wrongTenant = createCapabilityMetadata(context, {
      tenantId: "tenant-b"
    });
    await assert.rejects(
      capabilityCall(
        context.capabilityClient,
        wrongTenant,
        (client, current, done) =>
          client.getPlacement({
            placementId: fixture.placement.placementId
          }, current, done)),
      matchGrpcStatus(status.NOT_FOUND));

    const userPlacement = await declarePlacement(
      createPlacementRequest({
        placementId: "security_fences_user",
        target: {
          user: {
            tenantId: "tenant-a",
            accountPrincipalId: "user:bob"
          }
        },
        parentPlacementId: fixture.placement.placementId
      }));
    await assert.rejects(
      capabilityCall(
        context.capabilityClient,
        valid,
        (client, current, done) =>
          client.getPlacement({
            placementId: userPlacement.placementId
          }, current, done)),
      matchGrpcStatus(status.NOT_FOUND));

    const invalidInvocation = workloadMetadata(
      context.capabilityWorkload.callerToken,
      suite.invocation.sign({
        tenantId: "tenant-a",
        subject: "user:alice",
        sessionId: "session-invalid",
        audience: "wrong-audience"
      }));
    await assert.rejects(
      capabilityCall(
        context.capabilityClient,
        invalidInvocation,
        (client, current, done) =>
          client.getPlacement({
            placementId: fixture.placement.placementId
          }, current, done)),
      matchGrpcStatus(status.UNAUTHENTICATED));

    await suite.policyd.replacePolicy({ roles: [], grants: [] });
    try {
      await assert.rejects(
        capabilityCall(
          context.capabilityClient,
          valid,
          (client, current, done) =>
            client.getPlacement({
              placementId: fixture.placement.placementId
            }, current, done)),
        matchGrpcStatus(status.PERMISSION_DENIED));
    } finally {
      await suite.policyd.replacePolicy({
        roles: [],
        grants: createCapabilityGrants()
      });
    }

    await suite.policyd.setAvailable(false);
    try {
      await assert.rejects(
        capabilityCall(
          context.capabilityClient,
          valid,
          (client, current, done) =>
            client.getPlacement({
              placementId: fixture.placement.placementId
            }, current, done)),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await suite.policyd.setAvailable(true);
    }
    await cancelRun(fixture.run.runId);
  });

interface SecurityFixture {
  readonly root: Placement;
  readonly placement: Placement;
  readonly workload: Workload;
  readonly run: Run;
}

async function createSecurityFixture(
  prefix: string
): Promise<SecurityFixture> {
  const context = getExecdTestContext();
  const root = await declarePlacement(
    createPlacementRequest({
      placementId: `${prefix}_root`,
      target: { global: {} }
    }));
  const placement = await declarePlacement(
    createPlacementRequest({
      placementId: `${prefix}_tenant`,
      target: { tenant: { tenantId: "tenant-a" } },
      parentPlacementId: root.placementId
    }));
  const appId = `${prefix}_app`;
  await declareTestApp(context.pkgd.client, {
    appId,
    placementId: placement.placementId,
    scope: { tenant: { tenantId: "tenant-a" } }
  });
  const workload = await declareWorkload(createWorkloadRequest({
    workloadId: `${prefix}_workload`,
    placementId: placement.placementId,
    appId,
    mode: "finite",
    actorPrincipalId: "agent:reviewer"
  }));
  await waitFor(
    async () => await getWorkload(workload.workloadId),
    (value) =>
      value.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_READY);
  const run = await createRun(`${prefix}_run`, workload.workloadId);
  return { root, placement, workload, run };
}

function callsForAllRpcs(
  client: ExecutionServiceClient,
  fixture: SecurityFixture
): readonly (() => Promise<unknown>)[] {
  const placementRequest = createPlacementRequest({
    placementId: `${fixture.placement.placementId}_new`,
    target: { tenant: { tenantId: "tenant-a" } },
    parentPlacementId: fixture.root.placementId
  });
  const workloadRequest = createWorkloadRequest({
    workloadId: fixture.workload.workloadId,
    placementId: fixture.placement.placementId,
    appId: `${fixture.placement.placementId
      .replace("_tenant", "")}_app`,
    mode: "finite",
    actorPrincipalId: "agent:reviewer"
  });
  return [
    () => unauthenticatedCall((done) =>
      client.declarePlacement(placementRequest, done)),
    () => unauthenticatedCall((done) =>
      client.getPlacement({
        placementId: fixture.placement.placementId
      }, done)),
    () => unauthenticatedCall((done) =>
      client.listPlacements({
        target: { tenant: { tenantId: "tenant-a" } },
        pageSize: 10,
        afterPlacementId: undefined
      }, done)),
    () => unauthenticatedCall((done) =>
      client.declareWorkload(workloadRequest, done)),
    () => unauthenticatedCall((done) =>
      client.getWorkload({
        workloadId: fixture.workload.workloadId
      }, done)),
    () => unauthenticatedCall((done) =>
      client.listWorkloads({
        placementId: fixture.placement.placementId,
        pageSize: 10,
        afterWorkloadId: undefined
      }, done)),
    () => unauthenticatedCall((done) =>
      client.createRun({
        runId: `${fixture.run.runId}_new`,
        workloadId: fixture.workload.workloadId
      }, done)),
    () => unauthenticatedCall((done) =>
      client.getRun({ runId: fixture.run.runId }, done)),
    () => unauthenticatedCall((done) =>
      client.listRuns({
        workloadId: fixture.workload.workloadId,
        pageSize: 10,
        afterRunId: undefined
      }, done)),
    () => unauthenticatedCall((done) =>
      client.cancelRun({ runId: fixture.run.runId }, done))
  ];
}

async function capabilityCall<T>(
  client: ExecutionServiceClient,
  metadata: Metadata,
  start: (
    client: ExecutionServiceClient,
    metadata: Metadata,
    done: (error: ServiceError | null, response: T) => void
  ) => ClientUnaryCall
): Promise<T> {
  return await callUnary((done) =>
    start(client, metadata, done));
}

async function unauthenticatedCall<T>(
  start: (
    done: (error: ServiceError | null, response: T) => void
  ) => ClientUnaryCall
): Promise<T> {
  return await callUnary(start);
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

async function cancelRun(runId: string): Promise<void> {
  const context = getExecdTestContext();
  await callUnary((done) =>
    context.client.cancelRun({ runId }, done));
  await waitFor(
    async () => await getRun(runId),
    (value) => value.phase === RunPhase.RUN_PHASE_CANCELLED);
}
