import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import type {
  InvocationVerificationKey
} from "@ctlflow/identityd/testing/stub";
import type {
  ResolveTenantResponse
} from "../generated/v1/tenantd.js";
import {
  getTenantdTestContext
} from "../suite/get-tenantd-test-context.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  createInvocationAuthority
} from "../support/create-invocation-authority.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("a current known invocation key remains usable during identityd outage", async () => {
  const context = getTenantdTestContext();
  await context.identityd.setMode("unavailable");
  try {
    const resolved = await resolveWithInvocation(
      context.invocation.sign({
        tenantId: "security_tenant",
        tokenId: "security-cached-key"
      }));
    assert.equal(resolved.tenantId, "security_tenant");
  } finally {
    await context.identityd.setMode("available");
  }
});

test("an unknown invocation key refreshes through identityd", async () => {
  const context = getTenantdTestContext();
  const rotated = await createInvocationAuthority(
    "rotated-key");
  const baseline =
    (await context.identityd.readRequests()).length;
  await context.identityd.setVerificationKeys(
    keyResponse(rotated.verificationKey));
  try {
    const resolved = await resolveWithInvocation(
      rotated.sign({
        tenantId: "security_tenant",
        tokenId: "security-rotated-key"
      }));
    assert.equal(resolved.tenantId, "security_tenant");
    assert.equal(
      (await context.identityd.readRequests()).length,
      baseline + 1);
  } finally {
    await context.identityd.setVerificationKeys(
      keyResponse(
        context.invocation.verificationKey));
  }

  await resolveWithInvocation(
    context.invocation.sign({
      tenantId: "security_tenant",
      tokenId: "security-restored-key"
    }));
});

test("unknown keys fail unavailable when identityd cannot provide authority", async () => {
  const context = getTenantdTestContext();
  const unknown = await createInvocationAuthority(
    "unknown-key");
  const token = unknown.sign({
    tenantId: "security_tenant",
    tokenId: "security-unknown-key"
  });

  await context.identityd.setMode("unavailable");
  try {
    await assert.rejects(
      resolveWithInvocation(token),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.identityd.setMode("available");
  }

  await context.identityd.setMode("denied");
  try {
    await assert.rejects(
      resolveWithInvocation(token),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.identityd.setMode("available");
  }
});

test("malformed identityd key responses fail unavailable", async () => {
  const context = getTenantdTestContext();
  const unknown = await createInvocationAuthority(
    "malformed-key");
  const key = unknown.verificationKey;
  const token = unknown.sign({
    tenantId: "security_tenant",
    tokenId: "security-malformed-key"
  });
  const validExpiry =
    new Date(Date.now() + 4 * 60_000).toISOString();
  const responses = [
    {
      keys: [],
      expiresAt: validExpiry
    },
    {
      keys: [key, key],
      expiresAt: validExpiry
    },
    {
      keys: [{
        ...key,
        algorithm: "none"
      }],
      expiresAt: validExpiry
    },
    {
      keys: [key],
      expiresAt:
        new Date(Date.now() - 1_000).toISOString()
    },
    {
      keys: [key],
      expiresAt:
        new Date(Date.now() + 6 * 60_000).toISOString()
    },
    {
      keys: Array.from(
        { length: 9 },
        (_value, index) => ({
          ...key,
          keyId: `oversized-key-${String(index)}`
        })),
      expiresAt: validExpiry
    }
  ] as const;

  try {
    for (const response of responses) {
      await context.identityd.setVerificationKeys(response);
      await assert.rejects(
        resolveWithInvocation(token),
        matchGrpcStatus(status.UNAVAILABLE));
    }
  } finally {
    await context.identityd.setVerificationKeys(
      keyResponse(
        context.invocation.verificationKey));
  }
});

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

async function resolveWithInvocation(
  invocation: string
): Promise<ResolveTenantResponse> {
  const context = getTenantdTestContext();
  return await callUnary<ResolveTenantResponse>((done) =>
    context.workloadClient.resolveTenant(
      { address: "security-tenant" },
      workloadMetadata(
        context.workload.callerToken,
        invocation),
      done));
}
