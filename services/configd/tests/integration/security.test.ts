import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Metadata,
  status
} from "@grpc/grpc-js";
import type {
  ConsumerBinding
} from "../generated/v1/configd.js";
import {
  getConfigdTestContext
} from "../suite/get-configd-test-context.js";
import {
  configureCapabilityPolicy
} from "../support/authorization/configure-capability-policy.js";
import type {
  CapabilityGrant
} from "../support/authorization/capability-grant.js";
import {
  createCapabilityMetadata
} from "../support/authorization/create-capability-metadata.js";
import {
  createConfigurationRequest
} from "../support/configurations/create-configuration-request.js";
import {
  publishConfiguration
} from "../support/configurations/publish-configuration.js";
import {
  resolveConfiguration
} from "../support/configurations/resolve-configuration.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  applyProjection
} from "../support/projections/apply-projection.js";
import {
  createSecretRequest
} from "../support/secrets/create-secret-request.js";
import {
  getSecretMetadata
} from "../support/secrets/get-secret-metadata.js";
import {
  publishSecret
} from "../support/secrets/publish-secret.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("operator authentication is certificate-bound and rejects mixed identity",
  async () => {
    const context = getConfigdTestContext();
    const request = createConfigurationRequest({
      configurationId: "operator_identity"
    });
    await publishConfiguration(context.client, request);

    await assert.rejects(
      resolveConfiguration(context.workloadClient, {
        configurationId: request.configurationId,
        configurationVersionId: request.configurationVersionId,
        binding: request.binding
      }),
      matchGrpcStatus(status.UNAUTHENTICATED));
    await assert.rejects(
      resolveConfiguration(context.unadmittedOperatorClient, {
        configurationId: request.configurationId,
        configurationVersionId: request.configurationVersionId,
        binding: request.binding
      }),
      matchGrpcStatus(status.PERMISSION_DENIED));
    await assert.rejects(
      resolveConfiguration(
        context.client,
        {
          configurationId: request.configurationId,
          configurationVersionId: request.configurationVersionId,
          binding: request.binding
        },
        workloadMetadata(
          context.capabilityWorkload.callerToken)),
      matchGrpcStatus(status.UNAUTHENTICATED));
  });

test("all five RPCs reject absent and unadmitted caller identity",
  async () => {
    const context = getConfigdTestContext();
    const configuration = createConfigurationRequest({
      configurationId: "admission_configuration"
    });
    const secret = createSecretRequest({
      secretId: "admission_secret"
    });
    const applyRequest = {
      target: {
        configuration: {
          configurationId: configuration.configurationId,
          configurationVersionId:
            configuration.configurationVersionId
        }
      },
      binding: configuration.binding
    };
    const missingIdentity = [
      () => publishConfiguration(context.workloadClient, configuration),
      () => resolveConfiguration(context.workloadClient, {
        configurationId: configuration.configurationId,
        configurationVersionId:
          configuration.configurationVersionId,
        binding: configuration.binding
      }),
      () => publishSecret(context.workloadClient, secret),
      () => getSecretMetadata(context.workloadClient, {
        secretId: secret.secretId,
        binding: secret.binding
      })
    ];
    for (const operation of missingIdentity) {
      await assert.rejects(
        operation(),
        matchGrpcStatus(status.UNAUTHENTICATED));
    }
    await assert.rejects(
      applyProjection(
        context.workloadClient,
        applyRequest,
        new Metadata()),
      matchGrpcStatus(status.UNAUTHENTICATED));

    for (const operation of [
      () => publishConfiguration(
        context.unadmittedOperatorClient,
        configuration),
      () => resolveConfiguration(context.unadmittedOperatorClient, {
        configurationId: configuration.configurationId,
        configurationVersionId:
          configuration.configurationVersionId,
        binding: configuration.binding
      }),
      () => publishSecret(context.unadmittedOperatorClient, secret),
      () => getSecretMetadata(context.unadmittedOperatorClient, {
        secretId: secret.secretId,
        binding: secret.binding
      })
    ]) {
      await assert.rejects(
        operation(),
        matchGrpcStatus(status.PERMISSION_DENIED));
    }
  });

test("capabilities publish and read exact Tenant resources", async () => {
  const context = getConfigdTestContext();
  const tenantId = "capability_tenant";
  const configuration = createConfigurationRequest({
    configurationId: "capability_configuration",
    placementId: "capability_placement",
    consumerId: "capability_workload",
    scope: { kind: "tenant", tenantId }
  });
  const secret = createSecretRequest({
    secretId: "capability_secret",
    placementId: "capability_placement",
    consumerId: "capability_workload",
    scope: { kind: "tenant", tenantId }
  });
  await configureCapabilityPolicy(context, {
    tenantId,
    grants: [
      grant("configurations.publish", resourcePath(
        tenantId,
        configuration,
        "configurations",
        configuration.configurationId)),
      grant("configurations.read", resourcePath(
        tenantId,
        configuration,
        "configurations",
        configuration.configurationId)),
      grant("secrets.publish", resourcePath(
        tenantId,
        secret,
        "secrets",
        secret.secretId)),
      grant("secrets.read_metadata", resourcePath(
        tenantId,
        secret,
        "secrets",
        secret.secretId))
    ]
  });
  const metadata = createCapabilityMetadata(context, {
    tenantId,
    tokenId: "configd-capability-tenant"
  });
  const publishedConfiguration = await publishConfiguration(
    context.workloadClient,
    configuration,
    metadata);
  const publishedSecret = await publishSecret(
    context.workloadClient,
    secret,
    metadata);
  assert.deepEqual(
    (await resolveConfiguration(
      context.workloadClient,
      {
        configurationId: configuration.configurationId,
        configurationVersionId:
          configuration.configurationVersionId,
        binding: configuration.binding
      },
      metadata)).configuration,
    publishedConfiguration.configuration);
  assert.deepEqual(
    (await getSecretMetadata(
      context.workloadClient,
      {
        secretId: secret.secretId,
        binding: secret.binding
      },
      metadata)).secret,
    publishedSecret.secret);
});

test("capability scopes enforce Workspace, User, and Global fences",
  async () => {
    const context = getConfigdTestContext();
    const tenantId = "scope_tenant";
    const workspaceId = "scope_workspace";
    const workspace = createConfigurationRequest({
      configurationId: "scope_workspace_config",
      scope: { kind: "workspace", tenantId, workspaceId }
    });
    await configureCapabilityPolicy(context, {
      tenantId,
      workspaceId,
      grants: [grant(
        "configurations.publish",
        `/tenants/${tenantId}/workspaces/${workspaceId}`
        + configPath(workspace, workspace.configurationId))]
    });
    assert.equal(
      (await publishConfiguration(
        context.workloadClient,
        workspace,
        createCapabilityMetadata(context, {
          tenantId,
          workspaceId,
          tokenId: "configd-workspace"
        }))).configuration?.configurationId,
      workspace.configurationId);

    const account = "user:alice";
    const user = createSecretRequest({
      secretId: "scope_user_secret",
      scope: {
        kind: "user",
        tenantId,
        accountPrincipalId: account
      }
    });
    await configureCapabilityPolicy(context, {
      tenantId,
      grants: [grant(
        "secrets.publish",
        `/tenants/${tenantId}/accounts/${account}`
        + secretPath(user, user.secretId))]
    });
    assert.equal(
      (await publishSecret(
        context.workloadClient,
        user,
        createCapabilityMetadata(context, {
          tenantId,
          subject: account,
          tokenId: "configd-user"
        }))).secret?.secretId,
      user.secretId);

    await assert.rejects(
      publishConfiguration(
        context.workloadClient,
        createConfigurationRequest({
          configurationId: "scope_global_denied"
        }),
        createCapabilityMetadata(context, {
          tenantId,
          tokenId: "configd-global-denied"
        })),
      matchGrpcStatus(status.PERMISSION_DENIED));
  });

test("capability scope mismatch is concealed before policy evaluation",
  async () => {
    const context = getConfigdTestContext();
    const request = createConfigurationRequest({
      configurationId: "scope_concealed",
      scope: {
        kind: "tenant",
        tenantId: "scope_target_tenant"
      }
    });
    await configureCapabilityPolicy(context, {
      tenantId: "scope_invocation_tenant",
      grants: []
    });
    await assert.rejects(
      publishConfiguration(
        context.workloadClient,
        request,
        createCapabilityMetadata(context, {
          tenantId: "scope_invocation_tenant",
          tokenId: "configd-scope-concealed"
        })),
      matchGrpcStatus(status.NOT_FOUND));

    const workspaceInvocation = createCapabilityMetadata(context, {
      tenantId: "scope_target_tenant",
      workspaceId: "scope_child",
      tokenId: "configd-parent-concealed"
    });
    await assert.rejects(
      publishConfiguration(
        context.workloadClient,
        request,
        workspaceInvocation),
      matchGrpcStatus(status.NOT_FOUND));
  });

test("policy denial and disabled principal fail closed", async () => {
  const context = getConfigdTestContext();
  const tenantId = "policy_denial_tenant";
  const request = createSecretRequest({
    secretId: "policy_denial_secret",
    scope: { kind: "tenant", tenantId }
  });
  const metadata = createCapabilityMetadata(context, {
    tenantId,
    tokenId: "configd-policy-denial"
  });
  await configureCapabilityPolicy(context, {
    tenantId,
    grants: []
  });
  await assert.rejects(
    publishSecret(
      context.workloadClient,
      request,
      metadata),
    matchGrpcStatus(status.PERMISSION_DENIED));

  await configureCapabilityPolicy(context, {
    tenantId,
    principalEnabled: false,
    grants: [grant(
      "secrets.publish",
      `/tenants/${tenantId}${secretPath(
        request,
        request.secretId)}`)]
  });
  await assert.rejects(
    publishSecret(
      context.workloadClient,
      request,
      metadata),
    matchGrpcStatus(status.PERMISSION_DENIED));
});

test("per-RPC caller allowlists separate read and publication workloads",
  async () => {
    const context = getConfigdTestContext();
    const tenantId = "caller_surface_tenant";
    const request = createConfigurationRequest({
      configurationId: "caller_surface_config",
      scope: { kind: "tenant", tenantId }
    });
    await configureCapabilityPolicy(context, {
      tenantId,
      grants: [grant(
        "configurations.publish",
        `/tenants/${tenantId}${configPath(
          request,
          request.configurationId)}`)]
    });
    await assert.rejects(
      publishConfiguration(
        context.workloadClient,
        request,
        createCapabilityMetadata(
          context,
          {
            tenantId,
            tokenId: "configd-read-only-publish"
          },
          true)),
      matchGrpcStatus(status.PERMISSION_DENIED));
  });

test("capability operations fail unavailable when Policyd is unavailable",
  async () => {
    const context = getConfigdTestContext();
    const tenantId = "policy_unavailable_tenant";
    const configuration = createConfigurationRequest({
      configurationId: "policy_unavailable_configuration",
      scope: { kind: "tenant", tenantId }
    });
    const secret = createSecretRequest({
      secretId: "policy_unavailable_secret",
      scope: { kind: "tenant", tenantId }
    });
    const metadata = createCapabilityMetadata(context, {
      tenantId,
      tokenId: "configd-policy-unavailable"
    });
    await context.policyd.setAvailable(false);
    try {
      for (const operation of [
        () => publishConfiguration(
          context.workloadClient,
          configuration,
          metadata),
        () => resolveConfiguration(
          context.workloadClient,
          {
            configurationId: configuration.configurationId,
            configurationVersionId:
              configuration.configurationVersionId,
            binding: configuration.binding
          },
          metadata),
        () => publishSecret(
          context.workloadClient,
          secret,
          metadata),
        () => getSecretMetadata(
          context.workloadClient,
          {
            secretId: secret.secretId,
            binding: secret.binding
          },
          metadata)
      ]) {
        await assert.rejects(
          operation(),
          matchGrpcStatus(status.UNAVAILABLE));
      }
    } finally {
      await context.policyd.setAvailable(true);
      await context.service.restart(context.environment);
    }
  });

function grant(operation: string, path: string): CapabilityGrant {
  return {
    subject: { kind: "principal", id: "user:alice" },
    operation,
    basePath: path,
    match: "exact"
  };
}

function resourcePath(
  tenantId: string,
  request: BindingRequest,
  collection: "configurations" | "secrets",
  resourceId: string
): string {
  return `/tenants/${tenantId}`
    + commonPath(request)
    + `/${collection}/${resourceId}`;
}

function configPath(
  request: BindingRequest,
  resourceId: string
): string {
  return commonPath(request) + `/configurations/${resourceId}`;
}

function secretPath(
  request: BindingRequest,
  resourceId: string
): string {
  return commonPath(request) + `/secrets/${resourceId}`;
}

function commonPath(
  request: BindingRequest
): string {
  const binding = request.binding;
  assert.ok(binding?.placement);
  return `/placements/${binding.placement.placementId}`
    + `/consumers/${binding.consumerId}`
    + `/purposes/${binding.purpose}`;
}

interface BindingRequest {
  readonly binding: ConsumerBinding | undefined;
}
