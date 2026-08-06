import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  RealizationPhase,
  RunPhase,
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
  waitForProbeStatus
} from "../support/wait-for-probe-status.js";
import {
  waitFor
} from "../support/wait-for.js";
import {
  createWorkloadRequest
} from "../support/workloads/create-workload-request.js";

test("persists intent and converges one Run Job across a production restart",
  async () => {
    const context = getExecdTestContext();
    const suite = getExecdTestSuite();
    const placement = await declarePlacement(
      "restart_placement");
    await declareTestApp(context.pkgd.client, {
      appId: "restart_app",
      placementId: placement.placementId,
      scope: { global: {} }
    });
    const workload = await declareWorkload({
      workloadId: "restart_workload",
      placementId: placement.placementId,
      appId: "restart_app"
    });
    await waitForReadyWorkload(workload.workloadId);
    const run = await createRun(
      "restart_run",
      workload.workloadId);
    await waitForRunPhase(run.runId, RunPhase.RUN_PHASE_RUNNING);
    const namespace = await getPlacementNamespace(
      suite.kubernetes,
      placement.placementId);
    assert.equal(
      (await listRunJobs(namespace, run.runId)).length,
      1);

    await context.process.restart();

    assert.equal(
      (await getPlacement(placement.placementId)).revision,
      placement.revision);
    const retainedWorkload = await getWorkload(workload.workloadId);
    assert.equal(retainedWorkload.placementId, placement.placementId);
    assert.equal(retainedWorkload.declaration?.packageComponent?.appId,
      "restart_app");
    const retainedRun = await getRun(run.runId);
    assert.equal(retainedRun.workloadId, workload.workloadId);
    assert.equal(retainedRun.workloadRevision, workload.revision);
    await waitFor(
      async () => await listRunJobs(namespace, run.runId),
      (jobs) => jobs.length === 1);
    await cancelRun(run.runId);
    await waitForRunPhase(run.runId, RunPhase.RUN_PHASE_CANCELLED);
  });

test("SQLite contains only migration metadata and Execd domain tables",
  async () => {
    const context = getExecdTestContext();
    const objects = await context.database.connection("sqlite_master")
      .select("type", "name")
      .whereIn("type", ["table", "view", "trigger"])
      .orderBy(["type", "name"]) as Array<{
        readonly type: string;
        readonly name: string;
      }>;

    assert.deepEqual(
      objects.filter((object) => object.type === "table")
        .map((object) => object.name),
      [
        "knex_migrations",
        "knex_migrations_lock",
        "placement_provisioners",
        "placements",
        "run_config_targets",
        "run_dependencies",
        "run_dependency_outputs",
        "run_dependency_parameters",
        "run_storage",
        "runs",
        "sqlite_sequence",
        "workload_config_targets",
        "workload_dependencies",
        "workload_dependency_outputs",
        "workload_dependency_parameters",
        "workload_interfaces",
        "workload_operations",
        "workload_storage",
        "workloads"
      ]);
    assert.deepEqual(
      objects.filter((object) => object.type === "view"),
      []);
    assert.deepEqual(
      objects.filter((object) => object.type === "trigger"),
      []);
  });

test("readiness rejects behind, ahead, and locked migration ledgers",
  async () => {
    const context = getExecdTestContext();
    const migration = await context.database.connection(
      "knex_migrations").first();
    assert.ok(migration);
    await context.database.connection("knex_migrations")
      .where({ id: migration.id })
      .delete();
    try {
      await waitForProbeStatus(context.probePort, 503);
    } finally {
      await context.database.connection("knex_migrations")
        .insert(migration);
    }
    await waitForProbeStatus(context.probePort, 204);

    await context.database.connection("knex_migrations").insert({
      name: "9999_unexpected.js",
      batch: 2,
      migration_time: new Date().toISOString()
    });
    try {
      await waitForProbeStatus(context.probePort, 503);
    } finally {
      await context.database.connection("knex_migrations")
        .where({ name: "9999_unexpected.js" })
        .delete();
    }
    await waitForProbeStatus(context.probePort, 204);

    await context.database.connection("knex_migrations_lock")
      .update({ is_locked: 1 });
    try {
      await waitForProbeStatus(context.probePort, 503);
    } finally {
      await context.database.connection("knex_migrations_lock")
        .update({ is_locked: 0 });
    }
    await waitForProbeStatus(context.probePort, 204);
  });

test("readiness and RPCs fail closed when a mapped table is missing",
  async () => {
    const context = getExecdTestContext();
    const workloadId = "restart_workload";
    await context.database.connection.schema.renameTable(
      "workloads",
      "workloads_incompatible");
    try {
      await waitForProbeStatus(context.probePort, 503);
      await assert.rejects(
        getWorkload(workloadId),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.database.connection.schema.renameTable(
        "workloads_incompatible",
        "workloads");
    }
    await waitForProbeStatus(context.probePort, 204);
    assert.equal(
      (await getWorkload(workloadId)).workloadId,
      workloadId);
  });

test("startup rejects a workload-token lifetime Kubernetes cannot project",
  async () => {
    const context = getExecdTestContext();
    const name = "CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS";
    try {
      await assert.rejects(context.process.restart({
        [name]: "599"
      }));
    } finally {
      await context.process.restart({
        [name]: context.environment[name]!
      });
    }
    await waitForProbeStatus(context.probePort, 204);
  });

async function declarePlacement(
  placementId: string
): Promise<Placement> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.declarePlacement(createPlacementRequest({
      placementId,
      target: { global: {} }
    }), done));
}

async function getPlacement(
  placementId: string
): Promise<Placement> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.getPlacement({ placementId }, done));
}

async function declareWorkload(options: {
  readonly workloadId: string;
  readonly placementId: string;
  readonly appId: string;
}): Promise<Workload> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.declareWorkload(createWorkloadRequest({
      ...options,
      mode: "finite"
    }), done));
}

async function getWorkload(
  workloadId: string
): Promise<Workload> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.getWorkload({ workloadId }, done));
}

async function waitForReadyWorkload(
  workloadId: string
): Promise<Workload> {
  return await waitFor(
    async () => await getWorkload(workloadId),
    (value) =>
      value.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_READY);
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

async function waitForRunPhase(
  runId: string,
  phase: RunPhase
): Promise<Run> {
  return await waitFor(
    async () => await getRun(runId),
    (value) => value.phase === phase);
}

async function listRunJobs(
  namespace: string,
  runId: string
): Promise<readonly unknown[]> {
  return await listOwnedKubernetesObjects(
    getExecdTestSuite().kubernetes,
    "jobs",
    {
      "execution.ctlflow.io/run-id": runId
    },
    namespace);
}
