import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import type {
  InvocationVerificationKey
} from "@ctlflow/identityd/testing/production";
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
  createTenant
} from "../support/tenants/create-tenant.js";
import {
  findSpansForTrace
} from "../support/telemetry/find-spans-for-trace.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

const tenantId = "invocation_key_tenant";
const tenantAddress = "invocation-key-tenant";
let tenantCreated: Promise<void> | undefined;

test("a current known invocation key remains usable during identityd outage", async () => {
  const context = getTenantdTestContext();
  await ensureTenant();
  const invocation = context.invocation.sign({
    tenantId,
    tokenId: "security-cached-key"
  });
  await resolveWithInvocation(invocation);
  await context.identityd.setMode("unavailable");
  try {
    const resolved = await resolveWithInvocation(invocation);
    assert.equal(resolved.tenantId, tenantId);
  } finally {
    await context.identityd.setMode("available");
  }
});

test("an unknown invocation key refreshes through identityd", async () => {
  const context = getTenantdTestContext();
  await ensureTenant();
  const rotated = await createInvocationAuthority(
    "rotated-key");
  const traceId = "0a0b0c0d0e0f10111213141516171819";
  await context.identityd.setVerificationKeys(
    keyResponse(rotated.verificationKey));
  try {
    const resolved = await resolveWithInvocation(
      rotated.sign({
        tenantId,
        tokenId: "security-rotated-key"
      }),
      traceId);
    assert.equal(resolved.tenantId, tenantId);
    await waitForExport(
      context.collector.tracesPath,
      (value) => findSpansForTrace(value, traceId)
        .some((span) =>
          span.name === "identityd.GetInvocationVerificationKeys"));
  } finally {
    await context.identityd.setVerificationKeys(
      keyResponse(
        context.invocation.verificationKey));
  }

  await resolveWithInvocation(
    context.invocation.sign({
      tenantId,
      tokenId: "security-restored-key"
    }));
});

test("unknown keys fail closed during Identityd outage and after recovery",
  async () => {
    const context = getTenantdTestContext();
    const unknown = await createInvocationAuthority(
      "unknown-key");
    const token = unknown.sign({
      tenantId,
      tokenId: "security-unknown-key"
    });

    await context.identityd.setMode("unavailable");
    try {
      await assert.rejects(
        resolveWithInvocation(token),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.identityd.setMode("available");
      await context.service.restart(context.environment);
    }

    await assert.rejects(
      resolveWithInvocation(token),
      matchGrpcStatus(status.UNAUTHENTICATED));
  });

test("unavailable identityd key states fail unavailable", async () => {
  const context = getTenantdTestContext();
  const unknown = await createInvocationAuthority(
    "malformed-key");
  const key = unknown.verificationKey;
  const token = unknown.sign({
    tenantId,
    tokenId: "security-malformed-key"
  });
  const responses = [
    {
      keys: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    },
    {
      keys: Array.from(
        { length: 9 },
        (_value, index) => ({
          ...key,
          keyId: `oversized-key-${String(index)}`
        })),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
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
    await context.reconnectPolicyIdentity();
    await context.service.restart(context.environment);
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
  invocation: string,
  traceId?: string
): Promise<ResolveTenantResponse> {
  const context = getTenantdTestContext();
  const metadata = workloadMetadata(
    context.workload.callerToken,
    invocation);
  if (traceId !== undefined) {
    metadata.set(
      "traceparent",
      `00-${traceId}-1234567890abcdef-01`);
  }
  return await callUnary<ResolveTenantResponse>((done) =>
    context.workloadClient.resolveTenant(
      { address: tenantAddress },
      metadata,
      done));
}

async function ensureTenant(): Promise<void> {
  tenantCreated ??= createTenant(
    getTenantdTestContext(),
    {
      tenantId,
      address: tenantAddress,
      displayName: "Invocation Key Tenant"
    }).then(() => undefined);
  await tenantCreated;
}
