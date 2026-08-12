import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ConsumerBinding,
  PublishConfigurationResponse
} from "../generated/v1/configd.js";
import {
  DesiredState,
  RealizationPhase,
  type DeclarePlacementRequest,
  type DeclareWorkloadRequest,
  type Placement,
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

test("rolls continuous workloads onto changed configuration versions",
  async () => {
    const placement = await declarePlacement(createPlacementRequest({
      placementId: "configuration_rollout_placement",
      target: { global: {} }
    }));
    const workloadId = "configuration_rollout_workload";
    const appId = "configuration_rollout_app";
    const configurationId = "configuration_rollout_config";
    const binding = globalBinding(
      placement.placementId,
      workloadId,
      "runtime_config");
    let declared = false;
    try {
      const firstVersion = await publishConfiguration({
        configurationId,
        versionId: "configuration_rollout_v1",
        binding,
        content: Buffer.from('{"version":1}', "utf8")
      });
      await declareTestApp(getExecdTestContext().pkgd.client, {
        appId,
        placementId: placement.placementId,
        scope: { global: {} },
        artifact: getExecdTestSuite().applicationArtifact
      });
      const initialRequest = createWorkloadRequest({
        workloadId,
        placementId: placement.placementId,
        appId,
        mode: "continuous",
        configdTargets: [configurationTarget(
          configurationId,
          requireVersionId(firstVersion))]
      });
      const initial = await declareWorkload(initialRequest);
      declared = true;
      await waitForWorkloadReady(workloadId, initial.revision);
      const namespace = await getPlacementNamespace(
        getExecdTestSuite().kubernetes,
        placement.placementId);
      const firstPod = await waitForMountedConfiguration(
        namespace,
        workloadId,
        '{"version":1}');
      const replay = await declareWorkload({
        ...initialRequest,
        expectedRevision: initial.revision
      });
      assert.equal(replay.revision, initial.revision);
      const replayPod = await waitForMountedConfiguration(
        namespace,
        workloadId,
        '{"version":1}');
      assert.equal(replayPod.uid, firstPod.uid);

      const secondVersion = await publishConfiguration({
        configurationId,
        versionId: "configuration_rollout_v2",
        expectedRevision: 1n,
        binding,
        content: Buffer.from('{"version":2}', "utf8")
      });
      const updated = await declareWorkload(createWorkloadRequest({
        workloadId,
        placementId: placement.placementId,
        appId,
        mode: "continuous",
        expectedRevision: initial.revision,
        configdTargets: [configurationTarget(
          configurationId,
          requireVersionId(secondVersion))]
      }));
      assert.ok(updated.revision > initial.revision);
      const secondPod = await waitForReadyRollout(
        namespace,
        workloadId,
        updated.revision,
        '{"version":2}',
        firstPod.uid);
      assert.notEqual(secondPod.uid, firstPod.uid);
    } finally {
      if (declared) await suspendWorkload(workloadId);
    }
  });

type PublishOptions = {
  readonly configurationId: string;
  readonly versionId: string;
  readonly expectedRevision?: bigint;
  readonly binding: ConsumerBinding;
  readonly content: Buffer;
};

async function publishConfiguration(
  options: PublishOptions
): Promise<PublishConfigurationResponse> {
  const client = getExecdTestContext().configd.client;
  return await callUnary((done) => client.publishConfiguration({
    configurationId: options.configurationId,
    configurationVersionId: options.versionId,
    expectedRevision: options.expectedRevision,
    binding: options.binding,
    contentJson: options.content
  }, done));
}

function configurationTarget(
  configurationId: string,
  configurationVersionId: string
): {
  readonly purpose: string;
  readonly configuration: {
    readonly configurationId: string;
    readonly configurationVersionId: string;
  };
} {
  return {
    purpose: "runtime_config",
    configuration: { configurationId, configurationVersionId }
  };
}

function globalBinding(
  placementId: string,
  consumerId: string,
  purpose: string
): ConsumerBinding {
  return {
    placement: { placementId, global: {} },
    consumerId,
    purpose
  };
}

async function declarePlacement(
  request: DeclarePlacementRequest
): Promise<Placement> {
  return await callUnary((done) =>
    getExecdTestContext().client.declarePlacement(request, done));
}

async function declareWorkload(
  request: DeclareWorkloadRequest
): Promise<Workload> {
  return await callUnary((done) =>
    getExecdTestContext().client.declareWorkload(request, done));
}

async function waitForWorkloadReady(
  workloadId: string,
  revision: bigint
): Promise<void> {
  await waitFor(
    async () => await callUnary<Workload>((done) =>
      getExecdTestContext().client.getWorkload({ workloadId }, done)),
    (workload) =>
      workload.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_READY
      && workload.realization.observedRevision === revision,
    30_000);
}

async function suspendWorkload(workloadId: string): Promise<void> {
  const current = await callUnary<Workload>((done) =>
    getExecdTestContext().client.getWorkload({ workloadId }, done));
  const declaration = current.declaration;
  if (declaration === undefined) {
    throw new Error("Workload declaration is missing");
  }
  const suspended = await declareWorkload({
    workloadId,
    placementId: current.placementId,
    expectedRevision: current.revision,
    declaration: {
      ...declaration,
      desiredState: DesiredState.DESIRED_STATE_SUSPENDED
    }
  });
  await waitFor(
    async () => await callUnary<Workload>((done) =>
      getExecdTestContext().client.getWorkload({ workloadId }, done)),
    (workload) =>
      workload.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_SUSPENDED
      && workload.realization.observedRevision === suspended.revision,
    30_000);
}

async function waitForMountedConfiguration(
  namespace: string,
  workloadId: string,
  expected: string,
  previousUid?: string
): Promise<{ readonly name: string; readonly uid: string }> {
  return await waitFor(
    async () => await readMountedConfiguration(namespace, workloadId),
    (result) => result !== null
      && result.content === expected
      && (previousUid === undefined || result.uid !== previousUid),
    30_000).then((result) => {
      if (result === null) {
        throw new Error("Workload Pod is missing");
      }
      return { name: result.name, uid: result.uid };
    });
}

async function waitForReadyRollout(
  namespace: string,
  workloadId: string,
  revision: bigint,
  expected: string,
  previousUid: string
): Promise<{ readonly name: string; readonly uid: string }> {
  return await waitFor(
    async () => {
      const workload = await callUnary<Workload>((done) =>
        getExecdTestContext().client.getWorkload({ workloadId }, done));
      if (workload.realization?.phase
          !== RealizationPhase.REALIZATION_PHASE_READY
          || workload.realization.observedRevision !== revision) {
        return null;
      }
      const mounted = await readMountedConfiguration(
        namespace,
        workloadId);
      assert.ok(
        mounted,
        "Workload became ready without a running application Pod");
      assert.equal(
        mounted.runningUids.length,
        1,
        "Workload became ready with multiple application Pods active");
      assert.ok(
        !mounted.runningUids.includes(previousUid),
        "Workload became ready before its prior Pod stopped serving");
      return mounted;
    },
    (result) => result !== null && result.content === expected,
    30_000).then((result) => {
      if (result === null) {
        throw new Error("Workload Pod is missing");
      }
      return { name: result.name, uid: result.uid };
    });
}

async function readMountedConfiguration(
  namespace: string,
  workloadId: string
): Promise<{
  readonly name: string;
  readonly uid: string;
  readonly runningUids: readonly string[];
  readonly content: string;
} | null> {
  const kubernetes = getExecdTestSuite().kubernetes;
  const deployments = await kubernetes.runKubectl([
    "get",
    "deployments",
    "--namespace",
    namespace,
    "--output=json"
  ]);
  const deploymentList = JSON.parse(deployments.stdout) as {
    readonly items?: readonly {
      readonly metadata?: {
        readonly name?: string;
        readonly annotations?: Readonly<Record<string, string>>;
      };
    }[];
  };
  const workloadName = deploymentList.items?.find((candidate) =>
    candidate.metadata?.annotations?.[
      "execution.ctlflow.io/workload-id"] === workloadId)?.metadata?.name;
  if (workloadName === undefined) return null;
  const result = await kubernetes.runKubectl([
    "get",
    "pods",
    "--namespace",
    namespace,
    "--selector",
    `execution.ctlflow.io/workload=${workloadName}`,
    "--output=json"
  ]);
  const listed = JSON.parse(result.stdout) as {
    readonly items?: readonly {
      readonly metadata?: {
        readonly name?: string;
        readonly uid?: string;
      };
      readonly status?: { readonly phase?: string };
    }[];
  };
  const running = listed.items?.filter((candidate) =>
    candidate.status?.phase === "Running") ?? [];
  const pod = running[0];
  const name = pod?.metadata?.name;
  const uid = pod?.metadata?.uid;
  if (name === undefined || uid === undefined) return null;
  const runningUids = running.flatMap((candidate) => {
    const candidateUid = candidate.metadata?.uid;
    return candidateUid === undefined ? [] : [candidateUid];
  });
  const content = await kubernetes.runKubectl([
    "exec",
    name,
    "--namespace",
    namespace,
    "--container=application",
    "--",
    "node",
    "--input-type=module",
    "--eval",
    "import { readFile } from 'node:fs/promises';"
      + "process.stdout.write(await readFile("
      + "'/run/ctlflow/configurations/runtime_config/content','utf8'))"
  ]).then((value) => value.stdout).catch(() => "");
  return { name, uid, runningUids, content };
}

function requireVersionId(response: PublishConfigurationResponse): string {
  const value = response.version?.configurationVersionId;
  if (value === undefined || value.length === 0) {
    throw new Error("Configuration version is missing");
  }
  return value;
}
