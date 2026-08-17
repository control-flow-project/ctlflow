import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Metadata
} from "@grpc/grpc-js";
import {
  RealizationPhase,
  type DeclarePlacementRequest,
  type DeclareWorkloadRequest,
  type Placement,
  type Workload
} from "../generated/v1/execd.js";
import type {
  ConsumerBinding,
  PublishConfigurationResponse,
  PublishSecretResponse
} from "../generated/v1/configd.js";
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

test("realizes exact configuration, secret, and persistent storage",
  async () => {
    const placement = await declarePlacement(
      createPlacementRequest({
        placementId: "realization_direct_placement",
        target: { global: {} }
      }));
    const workloadId = "realization_direct_workload";
    const configuration = await publishConfiguration({
      configurationId: "realization_direct_config",
      versionId: "realization_direct_config_v1",
      binding: globalBinding(
        placement.placementId,
        workloadId,
        "runtime_config"),
      content: Buffer.from('{"mode":"test"}', "utf8")
    });
    const secret = await publishSecret({
      secretId: "realization_direct_secret",
      versionId: "realization_direct_secret_v1",
      binding: globalBinding(
        placement.placementId,
        workloadId,
        "api_credential"),
      material: Buffer.from([0x00, 0x10, 0x80, 0xff])
    });
    const context = getExecdTestContext();
    await declareTestApp(context.pkgd.client, {
      appId: "realization_direct_app",
      placementId: placement.placementId,
      scope: { global: {} }
    });
    const workload = await declareWorkload(createWorkloadRequest({
      workloadId,
      placementId: placement.placementId,
      appId: "realization_direct_app",
      mode: "finite",
      configdTargets: [
        {
          purpose: "runtime_config",
          configuration: {
            configurationId:
              configuration.configuration!.configurationId,
            configurationVersionId:
              configuration.version!.configurationVersionId
          }
        },
        {
          purpose: "api_credential",
          secret: {
            secretId: secret.secret!.secretId,
            secretVersionId: secret.version!.secretVersionId
          }
        }
      ],
      persistentStorage: [{
        storageId: "data",
        mountPath: "/data",
        capacityBytes: 1_048_576n
      }]
    }));
    const ready = await waitForWorkloadReady(workload.workloadId);
    assert.equal(ready.realization?.observedRevision, ready.revision);

    const namespace = await getPlacementNamespace(
      getExecdTestSuite().kubernetes,
      placement.placementId);
    assert.equal(
      (await ownedObjects(
        "configmaps",
        workloadId,
        namespace,
        "configd")).length,
      1);
    assert.equal(
      (await ownedObjects(
        "secrets",
        workloadId,
        namespace,
        "configd")).length,
      1);
    const claims = await listOwnedKubernetesObjects(
      getExecdTestSuite().kubernetes,
      "persistentvolumeclaims",
      {
        "execution.ctlflow.io/owner-service": "execd",
        "execution.ctlflow.io/app-id": "realization_direct_app",
        "execution.ctlflow.io/storage-id": "data"
      },
      namespace);
    assert.equal(claims.length, 1);
    const claimSpec = requireRecord(
      claims[0]!.spec,
      "persistent storage spec");
    const resources = requireRecord(
      claimSpec.resources,
      "persistent storage resources");
    const requests = requireRecord(
      resources.requests,
      "persistent storage requests");
    assert.equal(requests.storage, "1048576");
  });

test("realizes a provisioner-owned dependency claim and output",
  async () => {
    const root = await declarePlacement(
      createPlacementRequest({
        placementId: "realization_dependency_root",
        target: { global: {} }
      }));
    const placement = await declarePlacement(
      createPlacementRequest({
        placementId: "realization_dependency_placement",
        target: { tenant: { tenantId: "tenant-a" } },
        parentPlacementId: root.placementId
      }));
    await waitFor(
      async () => await getPlacement(placement.placementId),
      (value) =>
        value.realization?.phase
          === RealizationPhase.REALIZATION_PHASE_READY,
      30_000);
    const workloadId = "realization_dependency_workload";
    const parameter = await publishConfiguration({
      configurationId: "realization_dependency_input",
      versionId: "realization_dependency_input_v1",
      binding: tenantBinding(
        placement.placementId,
        workloadId,
        "provisioning_input"),
      content: Buffer.from('{"size":"small"}', "utf8")
    });
    const context = getExecdTestContext();
    await declareTestApp(context.pkgd.client, {
      appId: "realization_dependency_app",
      placementId: placement.placementId,
      scope: { tenant: { tenantId: "tenant-a" } }
    });
    const workloadRequest = createWorkloadRequest({
      workloadId,
      placementId: placement.placementId,
      appId: "realization_dependency_app",
      componentId: "dependent",
      mode: "finite",
      actorPrincipalId: "agent:reviewer",
      dependencies: [{
        componentId: "dependent",
        dependencyName: "Primary database",
        dependencyId: "database",
        provisioningParameters: [{
          parameterName: "settings",
          target: {
            purpose: "provisioning_input",
            configuration: {
              configurationId:
                parameter.configuration!.configurationId,
              configurationVersionId:
                parameter.version!.configurationVersionId
            }
          }
        }]
      }]
    });
    const initialWorkload = await declareWorkload(workloadRequest);

    const suite = getExecdTestSuite();
    const namespace = await getPlacementNamespace(
      suite.kubernetes,
      placement.placementId);
    const claim = await waitFor(
      async () => (await ownedObjects(
        "dependencyclaims",
        workloadId,
        namespace,
        "execd"))[0],
      (value): value is KubernetesObject => value !== undefined);
    if (claim === undefined) {
      throw new Error("DependencyClaim disappeared after observation");
    }
    const claimSpec = requireRecord(claim.spec, "claim spec");
    const claimId = requireString(claimSpec.claimId, "claim ID");
    const claimRevision = requireNumber(
      claimSpec.claimRevision,
      "claim revision");
    assert.equal(claimSpec.provisionerId, "test-provisioner");
    assert.equal(
      claimSpec.provisionerSubject,
      context.provisionerWorkload.callerSubject);
    assert.equal(claimSpec.optionsCanonicalJson,
      "{\"engine\":\"postgresql\"}");
    assert.match(
      JSON.stringify(claimSpec.parameters),
      /"parameterName":"settings"/);

    await installProvisionerStatusAccess(namespace);
    await assert.rejects(
      patchClaimStatus(
        claim.metadata.name,
        namespace,
        context.capabilityWorkload.callerSubject,
        pendingStatus(claimRevision)));
    await patchClaimStatus(
      claim.metadata.name,
      namespace,
      context.provisionerWorkload.callerSubject,
      pendingStatus(claimRevision));
    const pending = await waitFor(
      async () => await getWorkload(workloadId),
      (value) =>
        value.realization?.reason !== undefined
        && value.realization.phase
          === RealizationPhase.REALIZATION_PHASE_DEGRADED);
    assert.equal(
      pending.realization?.observedRevision,
      pending.revision);

    const output = await publishConfiguration({
      configurationId: "realization_dependency_output",
      versionId: "realization_dependency_output_v1",
      binding: tenantBinding(
        placement.placementId,
        workloadId,
        "database_connection"),
      content: Buffer.from(
        '{"host":"database.internal"}',
        "utf8"),
      claimId,
      claimRevision,
      metadata: workloadMetadata(
        context.provisionerWorkload.callerToken)
    });
    await patchClaimStatus(
      claim.metadata.name,
      namespace,
      context.provisionerWorkload.callerSubject,
      {
        observedClaimRevision: claimRevision,
        phase: "ready",
        ready: {
          bindingId: "binding-realization-dependency",
          bindingRevision: 1,
          configdTargets: [{
            purpose: "database_connection",
            configuration: {
              configurationId:
                output.configuration!.configurationId,
              configurationVersionId:
                output.version!.configurationVersionId
            }
          }]
        }
      });
    await waitForWorkloadReady(workloadId);
    const outputs = await ownedObjects(
      "configmaps",
      workloadId,
      namespace,
      "configd");
    assert.equal(outputs.length, 2);
    const replay = await declareWorkload({
      ...workloadRequest,
      expectedRevision: initialWorkload.revision
    });
    assert.equal(replay.revision, initialWorkload.revision);
  });

interface PublishConfigurationOptions {
  readonly configurationId: string;
  readonly versionId: string;
  readonly binding: ConsumerBinding;
  readonly content: Buffer;
  readonly claimId?: string;
  readonly claimRevision?: number;
  readonly metadata?: Metadata;
}

async function publishConfiguration(
  options: PublishConfigurationOptions
): Promise<PublishConfigurationResponse> {
  const context = getExecdTestContext();
  const client = options.metadata === undefined
    ? context.configd.client
    : context.configd.workloadClient;
  return await callUnary((done) =>
    options.metadata === undefined
      ? client.publishConfiguration({
          configurationId: options.configurationId,
          configurationVersionId: options.versionId,
          binding: options.binding,
          contentJson: options.content,
          dependencyClaimId: options.claimId,
          dependencyClaimRevision:
            options.claimRevision === undefined
              ? undefined
              : BigInt(options.claimRevision)
        }, done)
      : client.publishConfiguration({
          configurationId: options.configurationId,
          configurationVersionId: options.versionId,
          binding: options.binding,
          contentJson: options.content,
          dependencyClaimId: options.claimId,
          dependencyClaimRevision:
            options.claimRevision === undefined
              ? undefined
              : BigInt(options.claimRevision)
        }, options.metadata, done));
}

interface PublishSecretOptions {
  readonly secretId: string;
  readonly versionId: string;
  readonly binding: ConsumerBinding;
  readonly material: Buffer;
}

async function publishSecret(
  options: PublishSecretOptions
): Promise<PublishSecretResponse> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.configd.client.publishSecret({
      secretId: options.secretId,
      secretVersionId: options.versionId,
      binding: options.binding,
      material: options.material
    }, done));
}

function globalBinding(
  placementId: string,
  consumerId: string,
  purpose: string
): ConsumerBinding {
  return {
    placement: {
      placementId,
      global: {}
    },
    consumerId,
    purpose
  };
}

function tenantBinding(
  placementId: string,
  consumerId: string,
  purpose: string
): ConsumerBinding {
  return {
    placement: {
      placementId,
      tenant: { tenantId: "tenant-a" }
    },
    consumerId,
    purpose
  };
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

async function getPlacement(placementId: string): Promise<Placement> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.getPlacement({ placementId }, done));
}

async function waitForWorkloadReady(
  workloadId: string
): Promise<Workload> {
  return await waitFor(
    async () => await getWorkload(workloadId),
    (value) =>
      value.realization?.phase
        === RealizationPhase.REALIZATION_PHASE_READY,
    30_000);
}

async function ownedObjects(
  kind: string,
  workloadId: string,
  namespace: string,
  owner: "execd" | "configd"
): Promise<readonly KubernetesObject[]> {
  return await listOwnedKubernetesObjects(
    getExecdTestSuite().kubernetes,
    kind,
    {
      [`${owner === "execd"
        ? "execution"
        : "configuration"}.ctlflow.io/owner-service`]: owner,
      "execution.ctlflow.io/workload-id": workloadId
    },
    namespace);
}

async function installProvisionerStatusAccess(
  namespace: string
): Promise<void> {
  const context = getExecdTestContext();
  const suite = getExecdTestSuite();
  await suite.kubernetes.runKubectl(
    ["apply", "-f", "-"],
    JSON.stringify({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "Role",
      metadata: {
        name: "test-dependency-provisioner",
        namespace
      },
      rules: [{
        apiGroups: ["execution.ctlflow.io"],
        resources: ["dependencyclaims/status"],
        verbs: ["get", "patch", "update"]
      }]
    }));
  await suite.kubernetes.runKubectl(
    ["apply", "-f", "-"],
    JSON.stringify({
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: {
        name: "test-dependency-provisioner",
        namespace
      },
      subjects: [{
        kind: "ServiceAccount",
        name: "dependency-provisioner",
        namespace: suite.kubernetes.namespace
      }],
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "Role",
        name: "test-dependency-provisioner"
      }
    }));
  assert.equal(
    context.provisionerWorkload.callerSubject,
    `system:serviceaccount:${suite.kubernetes.namespace}:`
      + "dependency-provisioner");
}

async function patchClaimStatus(
  name: string,
  namespace: string,
  subject: string,
  value: Readonly<Record<string, unknown>>
): Promise<void> {
  await getExecdTestSuite().kubernetes.runKubectl([
    "patch",
    "dependencyclaim",
    name,
    "--namespace",
    namespace,
    "--subresource=status",
    "--type=merge",
    "--patch",
    JSON.stringify({ status: value }),
    `--as=${subject}`
  ]);
}

function pendingStatus(
  claimRevision: number
): Readonly<Record<string, unknown>> {
  return {
    observedClaimRevision: claimRevision,
    phase: "pending"
  };
}

function requireRecord(
  value: unknown,
  name: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object"
      || value === null
      || Array.isArray(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number"
      || !Number.isSafeInteger(value)
      || value <= 0) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}
