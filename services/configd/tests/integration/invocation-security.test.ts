import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import type {
  InvocationVerificationKey
} from "@ctlflow/identityd/testing/production";
import {
  getConfigdTestContext
} from "../suite/get-configd-test-context.js";
import {
  configureCapabilityPolicy
} from "../support/authorization/configure-capability-policy.js";
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
  createInvalidInvocationTokens
} from "../support/create-invalid-invocation-tokens.js";
import {
  createInvocationAuthority
} from "../support/create-invocation-authority.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

const tenantId = "invocation_tenant";
const request = createConfigurationRequest({
  configurationId: "invocation_configuration",
  scope: { kind: "tenant", tenantId }
});
let setup: Promise<void> | undefined;

test("capability callers require a valid invocation token", async () => {
  const context = getConfigdTestContext();
  await ensureInvocationState();

  await assert.rejects(
    resolveConfiguration(
      context.workloadClient,
      query(),
      workloadMetadata(
        context.capabilityWorkload.callerToken)),
    matchGrpcStatus(status.UNAUTHENTICATED));
  for (const token of createInvalidInvocationTokens(
    context.invocation)) {
    await assert.rejects(
      resolveWithInvocation(token),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }
});

test("capability callers accept a direct-account Run invocation", async () => {
  const context = getConfigdTestContext();
  await ensureInvocationState();
  const invocation = context.invocation.sign({
    tenantId,
    sessionId: null,
    runId: "configd-direct-run",
    tokenId: "configd-direct-run-token"
  });

  assert.equal(
    (await resolveWithInvocation(invocation)).configuration?.configurationId,
    request.configurationId);
});

test("unknown invocation keys refresh through real Identityd and Policyd",
  async () => {
    const context = getConfigdTestContext();
    await ensureInvocationState();
    const rotated = await createInvocationAuthority(
      "configd-rotated-key");
    const response = keyResponse(rotated.verificationKey);
    await context.identityd.setVerificationKeys(response);
    await context.policyd.setVerificationKeys(response);
    try {
      assert.equal(
        (await resolveWithInvocation(rotated.sign({
          tenantId,
          tokenId: "configd-rotated-key"
        }))).configuration?.configurationId,
        request.configurationId);
    } finally {
      const restored = keyResponse(
        context.invocation.verificationKey);
      await context.identityd.setVerificationKeys(restored);
      await context.policyd.setVerificationKeys(restored);
    }
  });

test("unknown invocation keys fail unavailable with Identityd unavailable",
  async () => {
    const context = getConfigdTestContext();
    await ensureInvocationState();
    const unknown = await createInvocationAuthority(
      "configd-unknown-key");
    const token = unknown.sign({
      tenantId,
      tokenId: "configd-unknown-key"
    });

    await context.identityd.setMode("unavailable");
    try {
      await assert.rejects(
        resolveWithInvocation(token),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.identityd.setMode("available");
      await context.reconnectPolicyIdentity();
      await context.service.restart(context.environment);
    }
  });

async function ensureInvocationState(): Promise<void> {
  setup ??= createInvocationState();
  await setup;
}

async function createInvocationState(): Promise<void> {
  const context = getConfigdTestContext();
  await publishConfiguration(context.client, request);
  const path = `/tenants/${tenantId}`
    + `/placements/${request.binding!.placement!.placementId}`
    + `/consumers/${request.binding!.consumerId}`
    + `/purposes/${request.binding!.purpose}`
    + `/configurations/${request.configurationId}`;
  await configureCapabilityPolicy(context, {
    tenantId,
    grants: [{
      subject: { kind: "principal", id: "user:alice" },
      operation: "configurations.read",
      basePath: path,
      match: "exact"
    }]
  });
}

async function resolveWithInvocation(token: string) {
  const context = getConfigdTestContext();
  return await resolveConfiguration(
    context.workloadClient,
    query(),
    workloadMetadata(
      context.capabilityWorkload.callerToken,
      token));
}

function query() {
  return {
    configurationId: request.configurationId,
    configurationVersionId: request.configurationVersionId,
    binding: request.binding
  };
}

function keyResponse(key: InvocationVerificationKey) {
  return {
    keys: [key],
    expiresAt: new Date(Date.now() + 4 * 60_000).toISOString()
  };
}
