import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  getConfigdTestContext
} from "../suite/get-configd-test-context.js";
import {
  createConsumerBinding
} from "../support/bindings/create-consumer-binding.js";
import {
  createConfigurationRequest
} from "../support/configurations/create-configuration-request.js";
import {
  publishConfiguration
} from "../support/configurations/publish-configuration.js";
import {
  deriveNativeName
} from "../support/kubernetes/derive-native-name.js";
import {
  provisionProjectionOwners
} from "../support/kubernetes/provision-projection-owners.js";
import {
  readProjectionObject
} from "../support/kubernetes/read-projection-object.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  applyProjection
} from "../support/projections/apply-projection.js";
import {
  createProjectionRequest
} from "../support/projections/create-projection-request.js";
import {
  deriveProjectionId
} from "../support/projections/derive-projection-id.js";
import {
  createSecretRequest
} from "../support/secrets/create-secret-request.js";
import {
  publishSecret
} from "../support/secrets/publish-secret.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("projects exact configuration and secret content into owned objects",
  async () => {
    const context = getConfigdTestContext();
    const configurationBinding = {
      placementId: "projection_config_placement",
      consumerId: "projection_config_workload",
      purpose: "runtime_config"
    };
    const configOwners = await provisionProjectionOwners(
      context.kubernetes,
      configurationBinding.placementId,
      configurationBinding.consumerId);
    const configuration = createConfigurationRequest({
      configurationId: "projection_configuration",
      ...configurationBinding,
      content: Buffer.from('{"projection":"configuration"}', "utf8")
    });
    await publishConfiguration(context.client, configuration);
    const configProjection = await applyProjection(
      context.workloadClient,
      createProjectionRequest(
        {
          configuration: {
            configurationId: configuration.configurationId,
            configurationVersionId:
              configuration.configurationVersionId
          }
        },
        configurationBinding),
      execdMetadata());
    const expectedConfigId = deriveProjectionId(
      "configuration",
      configuration.binding!);
    assert.equal(configProjection.projectionId, expectedConfigId);
    assert.equal(configProjection.projectionRevision, 1n);
    assert.deepEqual(configProjection.binding, configuration.binding);
    const configMap = await readProjectionObject(
      context.kubernetes,
      configOwners,
      "configmap",
      expectedConfigId);
    assert.equal(
      configMap.data.content,
      configuration.contentJson.toString("utf8"));
    assertProjectionOwnership(
      configMap,
      configOwners,
      expectedConfigId,
      configurationBinding.placementId,
      configurationBinding.consumerId);

    const secretBinding = {
      placementId: "projection_secret_placement",
      consumerId: "projection_secret_workload",
      purpose: "api_credential"
    };
    const secretOwners = await provisionProjectionOwners(
      context.kubernetes,
      secretBinding.placementId,
      secretBinding.consumerId);
    const material = Buffer.from([0x00, 0xff, 0x11, 0x80]);
    const secret = createSecretRequest({
      secretId: "projection_secret",
      ...secretBinding,
      material
    });
    await publishSecret(context.client, secret);
    const secretProjection = await applyProjection(
      context.workloadClient,
      createProjectionRequest(
        {
          secret: {
            secretId: secret.secretId,
            secretVersionId: secret.secretVersionId
          }
        },
        secretBinding),
      execdMetadata());
    const expectedSecretId = deriveProjectionId(
      "secret",
      secret.binding!);
    assert.equal(secretProjection.projectionId, expectedSecretId);
    const secretObject = await readProjectionObject(
      context.kubernetes,
      secretOwners,
      "secret",
      expectedSecretId);
    assert.equal(secretObject.type, "Opaque");
    assert.deepEqual(
      Buffer.from(secretObject.data.content!, "base64"),
      material);
    assertProjectionOwnership(
      secretObject,
      secretOwners,
      expectedSecretId,
      secretBinding.placementId,
      secretBinding.consumerId);
  });

test("reapplying a selected target is a no-op and repairs native drift",
  async () => {
    const context = getConfigdTestContext();
    const binding = {
      placementId: "projection_repair_placement",
      consumerId: "projection_repair_workload"
    };
    const owners = await provisionProjectionOwners(
      context.kubernetes,
      binding.placementId,
      binding.consumerId);
    const request = createConfigurationRequest({
      configurationId: "projection_repair",
      ...binding
    });
    await publishConfiguration(context.client, request);
    const applyRequest = createProjectionRequest(
      {
        configuration: {
          configurationId: request.configurationId,
          configurationVersionId: request.configurationVersionId
        }
      },
      binding);
    const created = await applyProjection(
      context.workloadClient,
      applyRequest,
      execdMetadata());
    assert.deepEqual(
      await applyProjection(
        context.workloadClient,
        applyRequest,
        execdMetadata()),
      created);

    const objectName = deriveNativeName(
      "ctlflow.configuration.v1.ProjectionObject",
      "prj-",
      created.projectionId);
    await context.kubernetes.runKubectl([
      "patch",
      "configmap",
      objectName,
      "--namespace",
      owners.namespaceName,
      "--type=merge",
      "--patch",
      '{"data":{"content":"drifted"}}'
    ]);
    const repaired = await applyProjection(
      context.workloadClient,
      applyRequest,
      execdMetadata());
    assert.deepEqual(repaired, created);
    assert.equal(
      (await readProjectionObject(
        context.kubernetes,
        owners,
        "configmap",
        created.projectionId)).data.content,
      request.contentJson.toString("utf8"));
  });

test("configuration projections advance once and refuse rollback",
  async () => {
    const context = getConfigdTestContext();
    const binding = {
      placementId: "projection_versions_placement",
      consumerId: "projection_versions_workload"
    };
    await provisionProjectionOwners(
      context.kubernetes,
      binding.placementId,
      binding.consumerId);
    const first = createConfigurationRequest({
      configurationId: "projection_versions",
      ...binding,
      content: Buffer.from('{"version":1}', "utf8")
    });
    await publishConfiguration(context.client, first);
    const firstRequest = createProjectionRequest({
      configuration: {
        configurationId: first.configurationId,
        configurationVersionId: first.configurationVersionId
      }
    }, binding);
    const initial = await applyProjection(
      context.workloadClient,
      firstRequest,
      execdMetadata());
    const second = createConfigurationRequest({
      configurationId: first.configurationId,
      configurationVersionId: "projection_versions_v2",
      expectedRevision: 1n,
      ...binding,
      content: Buffer.from('{"version":2}', "utf8")
    });
    await publishConfiguration(context.client, second);
    const changed = await applyProjection(
      context.workloadClient,
      createProjectionRequest({
        configuration: {
          configurationId: second.configurationId,
          configurationVersionId: second.configurationVersionId
        }
      }, binding),
      execdMetadata());
    assert.equal(changed.projectionId, initial.projectionId);
    assert.equal(changed.projectionRevision, 2n);

    await assert.rejects(
      applyProjection(
        context.workloadClient,
        firstRequest,
        execdMetadata()),
      matchGrpcStatus(status.FAILED_PRECONDITION));
  });

test("secret projections accept only the current version",
  async () => {
    const context = getConfigdTestContext();
    const binding = {
      placementId: "secret_current_placement",
      consumerId: "secret_current_workload",
      purpose: "api_credential"
    };
    await provisionProjectionOwners(
      context.kubernetes,
      binding.placementId,
      binding.consumerId);
    const first = createSecretRequest({
      secretId: "secret_current",
      ...binding
    });
    await publishSecret(context.client, first);
    const second = createSecretRequest({
      secretId: first.secretId,
      secretVersionId: "secret_current_v2",
      expectedRevision: 1n,
      ...binding,
      material: Buffer.from("replacement", "utf8")
    });
    await publishSecret(context.client, second);

    await assert.rejects(
      applyProjection(
        context.workloadClient,
        createProjectionRequest({
          secret: {
            secretId: first.secretId,
            secretVersionId: first.secretVersionId
          }
        }, binding),
        execdMetadata()),
      matchGrpcStatus(status.FAILED_PRECONDITION));
    assert.equal(
      (await applyProjection(
        context.workloadClient,
        createProjectionRequest({
          secret: {
            secretId: second.secretId,
            secretVersionId: second.secretVersionId
          }
        }, binding),
        execdMetadata())).projectionRevision,
      1n);
  });

test("projection validation requires exact targets, bindings, and owners",
  async () => {
    const context = getConfigdTestContext();
    const metadata = execdMetadata();
    await assert.rejects(
      applyProjection(
        context.workloadClient,
        {
          target: {},
          binding: createConsumerBinding()
        },
        metadata),
      matchGrpcStatus(status.INVALID_ARGUMENT));
    await assert.rejects(
      applyProjection(
        context.workloadClient,
        createProjectionRequest({
          configuration: {
            configurationId: "projection_absent",
            configurationVersionId: "projection_absent_v1"
          }
        }),
        metadata),
      matchGrpcStatus(status.NOT_FOUND));

    const request = createConfigurationRequest({
      configurationId: "projection_missing_owner",
      placementId: "projection_missing_owner_placement",
      consumerId: "projection_missing_owner_workload"
    });
    await publishConfiguration(context.client, request);
    await assert.rejects(
      applyProjection(
        context.workloadClient,
        createProjectionRequest({
          configuration: {
            configurationId: request.configurationId,
            configurationVersionId: request.configurationVersionId
          }
        }, {
          placementId: "projection_missing_owner_placement",
          consumerId: "projection_missing_owner_workload"
        }),
        metadata),
      matchGrpcStatus(status.NOT_FOUND));
  });

test("only the exact admitted Execd workload can apply projections",
  async () => {
    const context = getConfigdTestContext();
    const request = createProjectionRequest({
      configuration: {
        configurationId: "projection_admission",
        configurationVersionId: "projection_admission_v1"
      }
    });
    await assert.rejects(
      applyProjection(
        context.workloadClient,
        request,
        workloadMetadata(
          context.capabilityWorkload.callerToken)),
      matchGrpcStatus(status.PERMISSION_DENIED));
    await assert.rejects(
      applyProjection(
        context.workloadClient,
        request,
        workloadMetadata(
          context.execdWorkload.unadmittedToken)),
      matchGrpcStatus(status.PERMISSION_DENIED));
  });

test("refuses a native object not owned by the exact projection",
  async () => {
    const context = getConfigdTestContext();
    const binding = {
      placementId: "projection_collision_placement",
      consumerId: "projection_collision_workload"
    };
    const owners = await provisionProjectionOwners(
      context.kubernetes,
      binding.placementId,
      binding.consumerId);
    const request = createConfigurationRequest({
      configurationId: "projection_collision",
      ...binding
    });
    await publishConfiguration(context.client, request);
    const projectionId = deriveProjectionId(
      "configuration",
      request.binding!);
    const objectName = deriveNativeName(
      "ctlflow.configuration.v1.ProjectionObject",
      "prj-",
      projectionId);
    await context.kubernetes.runKubectl([
      "create",
      "configmap",
      objectName,
      "--namespace",
      owners.namespaceName,
      "--from-literal=content=foreign"
    ]);

    await assert.rejects(
      applyProjection(
        context.workloadClient,
        createProjectionRequest({
          configuration: {
            configurationId: request.configurationId,
            configurationVersionId: request.configurationVersionId
          }
        }, binding),
        execdMetadata()),
      matchGrpcStatus(status.ALREADY_EXISTS));
  });

function execdMetadata() {
  const context = getConfigdTestContext();
  return workloadMetadata(context.execdWorkload.callerToken);
}

function assertProjectionOwnership(
  object: {
    readonly metadata: {
      readonly annotations: Readonly<Record<string, string>>;
      readonly ownerReferences: readonly {
        readonly apiVersion: string;
        readonly kind: string;
        readonly name: string;
        readonly uid: string;
        readonly controller: boolean;
        readonly blockOwnerDeletion: boolean;
      }[];
    };
    readonly data: Readonly<Record<string, string>>;
  },
  owners: {
    readonly serviceAccountName: string;
    readonly serviceAccountUid: string;
  },
  projectionId: string,
  placementId: string,
  workloadId: string
): void {
  assert.deepEqual(object.metadata.annotations, {
    "configuration.ctlflow.io/owner-service": "configd",
    "configuration.ctlflow.io/projection-id": projectionId,
    "execution.ctlflow.io/placement-id": placementId,
    "execution.ctlflow.io/workload-id": workloadId
  });
  assert.deepEqual(object.metadata.ownerReferences, [{
    apiVersion: "v1",
    kind: "ServiceAccount",
    name: owners.serviceAccountName,
    uid: owners.serviceAccountUid,
    controller: false,
    blockOwnerDeletion: false
  }]);
  assert.deepEqual(Object.keys(object.data), ["content"]);
}
