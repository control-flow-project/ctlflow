import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import type {
  InvocationVerificationKey
} from "@ctlflow/identityd/testing/production";
import {
  getPkgdTestContext
} from "../suite/get-pkgd-test-context.js";
import {
  configureCapabilityPolicy
} from "../support/authorization/configure-capability-policy.js";
import {
  createApp
} from "../support/apps/create-app.js";
import {
  getApp
} from "../support/apps/get-app.js";
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
  createPackageRequest
} from "../support/packages/create-package-request.js";
import {
  declarePackage
} from "../support/packages/declare-package.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

const tenantId = "invocation_tenant";
const appId = "invocation_app";
const appPath = `/tenants/${tenantId}/apps/${appId}`;
let setup: Promise<void> | undefined;

test("capability callers require a valid invocation token", async () => {
  const context = getPkgdTestContext();
  await ensureInvocationState();

  await assert.rejects(
    getApp(
      context.workloadClient,
      appId,
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

test("unknown invocation keys refresh through real Identityd and Policyd",
  async () => {
    const context = getPkgdTestContext();
    await ensureInvocationState();
    const rotated = await createInvocationAuthority(
      "pkgd-rotated-key");
    const response = keyResponse(rotated.verificationKey);
    await context.identityd.setVerificationKeys(response);
    await context.policyd.setVerificationKeys(response);
    try {
      assert.equal(
        (await resolveWithInvocation(rotated.sign({
          tenantId,
          tokenId: "pkgd-rotated-key"
        }))).appId,
        appId);
    } finally {
      const restored = keyResponse(
        context.invocation.verificationKey);
      await context.identityd.setVerificationKeys(restored);
      await context.policyd.setVerificationKeys(restored);
    }

    assert.equal(
      (await resolveWithInvocation(context.invocation.sign({
        tenantId,
        tokenId: "pkgd-restored-key"
      }))).appId,
      appId);
  });

test("unknown invocation keys fail unavailable when Identityd is unavailable",
  async () => {
    const context = getPkgdTestContext();
    await ensureInvocationState();
    const unknown = await createInvocationAuthority(
      "pkgd-unknown-key");
    const token = unknown.sign({
      tenantId,
      tokenId: "pkgd-unknown-key"
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
  const context = getPkgdTestContext();
  const packageId = "invocation_package";
  await declarePackage(context, createPackageRequest({ packageId }));
  await createApp(
    context.client,
    {
      appId,
      scope: {
        tenant: {
          tenantId
        }
      },
      placementId: "placement_invocation",
      packageId,
      desiredPackageGeneration: 1n
    });
  await configureCapabilityPolicy(context, {
    tenantId,
    grants: [{
      subject: {
        kind: "principal",
        id: "user:alice"
      },
      operation: "apps.read",
      basePath: appPath,
      match: "exact"
    }]
  });
}

async function resolveWithInvocation(
  invocation: string
): ReturnType<typeof getApp> {
  const context = getPkgdTestContext();
  return await getApp(
    context.workloadClient,
    appId,
    workloadMetadata(
      context.capabilityWorkload.callerToken,
      invocation));
}

function keyResponse(
  key: InvocationVerificationKey
): {
  readonly keys: readonly InvocationVerificationKey[];
  readonly expiresAt: string;
} {
  return {
    keys: [key],
    expiresAt:
      new Date(Date.now() + 4 * 60_000).toISOString()
  };
}
