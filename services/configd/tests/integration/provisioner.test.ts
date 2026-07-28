import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  getConfigdTestContext
} from "../suite/get-configd-test-context.js";
import {
  createConfigurationRequest
} from "../support/configurations/create-configuration-request.js";
import {
  publishConfiguration
} from "../support/configurations/publish-configuration.js";
import {
  createDependencyClaim
} from "../support/kubernetes/create-dependency-claim.js";
import {
  provisionProjectionOwners
} from "../support/kubernetes/provision-projection-owners.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  createSecretRequest
} from "../support/secrets/create-secret-request.js";
import {
  publishSecret
} from "../support/secrets/publish-secret.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("provisioner publishes configuration and secrets through an exact claim",
  async () => {
    const context = getConfigdTestContext();
    const tenantId = "provisioned_tenant";
    const placementId = "provisioned_placement";
    const consumerId = "provisioned_workload";
    const claimId = "dpc-11111111111111111111111111111111";
    const claimRevision = 3n;
    const owners = await provisionProjectionOwners(
      context.kubernetes,
      placementId,
      consumerId);
    await createDependencyClaim(
      context.kubernetes,
      owners,
      {
        claimId,
        claimRevision,
        placementId,
        workloadId: consumerId,
        provisionerSubject:
          context.provisionerWorkload.callerSubject
      });
    const metadata = workloadMetadata(
      context.provisionerWorkload.callerToken);

    const configuration = await publishConfiguration(
      context.workloadClient,
      createConfigurationRequest({
        configurationId: "provisioned_configuration",
        placementId,
        scope: { kind: "tenant", tenantId },
        consumerId,
        dependencyClaimId: claimId,
        dependencyClaimRevision: claimRevision
      }),
      metadata);
    assert.deepEqual(
      await publishConfiguration(
        context.workloadClient,
        createConfigurationRequest({
          configurationId: "provisioned_configuration",
          placementId,
          scope: { kind: "tenant", tenantId },
          consumerId,
          dependencyClaimId: claimId,
          dependencyClaimRevision: claimRevision
        }),
        metadata),
      configuration);
    const secret = await publishSecret(
      context.workloadClient,
      createSecretRequest({
        secretId: "provisioned_secret",
        placementId,
        scope: { kind: "tenant", tenantId },
        consumerId,
        dependencyClaimId: claimId,
        dependencyClaimRevision: claimRevision
      }),
      metadata);
    assert.equal(configuration.configuration?.revision, 1n);
    assert.equal(secret.secret?.revision, 1n);
  });

test("provisioner requires both selector fields and a current claim",
  async () => {
    const context = getConfigdTestContext();
    const metadata = workloadMetadata(
      context.provisionerWorkload.callerToken);
    const base = createConfigurationRequest({
      configurationId: "provisioner_selector",
      scope: {
        kind: "tenant",
        tenantId: "provisioner_selector_tenant"
      }
    });

    for (const request of [
      {
        ...base,
        dependencyClaimId:
          "dpc-22222222222222222222222222222222"
      },
      {
        ...base,
        dependencyClaimRevision: 1n
      },
      {
        ...base,
        dependencyClaimId:
          "dpc-22222222222222222222222222222222",
        dependencyClaimRevision: 0n
      }
    ]) {
      await assert.rejects(
        publishConfiguration(
          context.workloadClient,
          request,
          metadata),
        matchGrpcStatus(status.INVALID_ARGUMENT));
    }
    await assert.rejects(
      publishConfiguration(
        context.workloadClient,
        {
          ...base,
          dependencyClaimId:
            "dpc-22222222222222222222222222222222",
          dependencyClaimRevision: 1n
        },
        metadata),
      matchGrpcStatus(status.NOT_FOUND));
  });

test("provisioner cannot publish into Global scope", async () => {
  const context = getConfigdTestContext();
  const claim = {
    dependencyClaimId:
      "dpc-77777777777777777777777777777777",
    dependencyClaimRevision: 1n
  };
  const metadata = workloadMetadata(
    context.provisionerWorkload.callerToken);
  for (const publish of [
    () => publishConfiguration(
      context.workloadClient,
      createConfigurationRequest({
        configurationId: "global_provisioner",
        ...claim
      }),
      metadata),
    () => publishSecret(
      context.workloadClient,
      createSecretRequest({
        secretId: "global_provisioner",
        ...claim
      }),
      metadata)
  ]) {
    await assert.rejects(
      publish(),
      matchGrpcStatus(status.PERMISSION_DENIED));
  }
});

test("provisioner claim fences caller, revision, placement, and workload",
  async () => {
    const context = getConfigdTestContext();
    const scope = {
      kind: "tenant" as const,
      tenantId: "claim_fence_tenant"
    };
    const placementId = "claim_fence_placement";
    const consumerId = "claim_fence_workload";
    const claimId = "dpc-33333333333333333333333333333333";
    const owners = await provisionProjectionOwners(
      context.kubernetes,
      placementId,
      consumerId);
    await createDependencyClaim(
      context.kubernetes,
      owners,
      {
        claimId,
        claimRevision: 5n,
        placementId,
        workloadId: consumerId,
        provisionerSubject:
          context.provisionerWorkload.callerSubject
      });
    const metadata = workloadMetadata(
      context.provisionerWorkload.callerToken);

    await assert.rejects(
      publishConfiguration(
        context.workloadClient,
        createConfigurationRequest({
          configurationId: "claim_wrong_revision",
          placementId,
          scope,
          consumerId,
          dependencyClaimId: claimId,
          dependencyClaimRevision: 4n
        }),
        metadata),
      matchGrpcStatus(status.FAILED_PRECONDITION));
    await assert.rejects(
      publishConfiguration(
        context.workloadClient,
        createConfigurationRequest({
          configurationId: "claim_wrong_placement",
          placementId: "another_placement",
          scope,
          consumerId,
          dependencyClaimId: claimId,
          dependencyClaimRevision: 5n
        }),
        metadata),
      matchGrpcStatus(status.NOT_FOUND));
    await assert.rejects(
      publishConfiguration(
        context.workloadClient,
        createConfigurationRequest({
          configurationId: "claim_wrong_workload",
          placementId,
          scope,
          consumerId: "another_workload",
          dependencyClaimId: claimId,
          dependencyClaimRevision: 5n
        }),
        metadata),
      matchGrpcStatus(status.FAILED_PRECONDITION));

    const foreignClaimId =
      "dpc-66666666666666666666666666666666";
    await createDependencyClaim(
      context.kubernetes,
      owners,
      {
        claimId: foreignClaimId,
        claimRevision: 1n,
        placementId,
        workloadId: consumerId,
        provisionerSubject:
          "system:serviceaccount:foreign:provisioner"
      });
    await assert.rejects(
      publishConfiguration(
        context.workloadClient,
        createConfigurationRequest({
          configurationId: "claim_wrong_provisioner",
          placementId,
          scope,
          consumerId,
          dependencyClaimId: foreignClaimId,
          dependencyClaimRevision: 1n
        }),
        metadata),
      matchGrpcStatus(status.PERMISSION_DENIED));
  });

test("operator and capability publications cannot carry a dependency claim",
  async () => {
    const context = getConfigdTestContext();
    const request = createSecretRequest({
      secretId: "operator_claim_rejected",
      dependencyClaimId:
        "dpc-44444444444444444444444444444444",
      dependencyClaimRevision: 1n
    });
    await assert.rejects(
      publishSecret(context.client, request),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  });

test("unadmitted workloads cannot use the provisioner path", async () => {
  const context = getConfigdTestContext();
  await assert.rejects(
    publishSecret(
      context.workloadClient,
      createSecretRequest({
        secretId: "unadmitted_provisioner",
        dependencyClaimId:
          "dpc-55555555555555555555555555555555",
        dependencyClaimRevision: 1n
      }),
      workloadMetadata(
        context.unadmittedWorkload.callerToken)),
    matchGrpcStatus(status.PERMISSION_DENIED));
});
