import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  AccessDecision
} from "../generated/v1/policyd.js";
import {
  getPolicydTestContext
} from "../suite/get-policyd-test-context.js";
import {
  callCheckAccess
} from "../support/call-check-access.js";
import {
  createInvocationAuthority
} from "../support/create-invocation-authority.js";
import {
  directGrant
} from "../support/direct-grant.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  principalFact
} from "../support/principal-fact.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

const request = {
  operation: "tenants.read",
  resourcePath: "/tenants/acme",
  tenantId: "acme"
};

test("requires a current bound workload token", async () => {
  const context = await arrangeAllow();
  const invocation = context.invocation.sign({ tenantId: "acme" });
  for (const token of [
    undefined,
    "not-a-token",
    context.workloads.tenantd.expiredToken,
    context.workloads.tenantd.overlongToken,
    context.workloads.tenantd.wrongAudienceToken,
    context.workloads.tenantd.unboundToken
  ]) {
    await assert.rejects(
      callCheckAccess(request, {
        metadata: workloadMetadata(token, invocation)
      }),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }
});

test("requires an independently valid invocation JWT", async () => {
  const context = await arrangeAllow();
  const now = Math.floor(Date.now() / 1_000);
  const other = await createInvocationAuthority("other-key");
  const invalid = [
    undefined,
    "not-a-token",
    other.sign({ tenantId: "acme" }),
    context.invocation.sign({
      tenantId: "acme",
      issuer: "https://other.test"
    }),
    context.invocation.sign({
      tenantId: "acme",
      audience: "other-audience"
    }),
    context.invocation.sign({
      tenantId: "acme",
      issuedAt: now - 120,
      notBefore: now - 120,
      expiresAt: now - 60
    }),
    context.invocation.sign({
      tenantId: "acme",
      issuedAt: now,
      notBefore: now,
      expiresAt: now + 61
    }),
    context.invocation.sign({
      tenantId: "acme",
      authorityClaim: true
    }),
    context.invocation.sign({
      tenantId: "acme",
      subject: "agent:reviewer"
    }),
    context.invocation.sign({
      workspaceId: "atlas"
    })
  ];
  for (const token of invalid) {
    await assert.rejects(
      callCheckAccess(request, {
        metadata: workloadMetadata(
          context.workloads.tenantd.callerToken,
          token)
      }),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }
});

test("rejects malformed and authority-bearing invocation payloads", async () => {
  const context = await arrangeAllow();
  const now = Math.floor(Date.now() / 1_000);
  for (const payload of [
    "{}",
    JSON.stringify({
      iss: context.invocation.issuer,
      aud: context.invocation.audience,
      sub: "user:alice",
      iat: now,
      nbf: now,
      exp: now + 30,
      jti: "token",
      tenant_id: "acme",
      session_id: "session",
      run_id: "run"
    }),
    JSON.stringify({
      iss: context.invocation.issuer,
      aud: context.invocation.audience,
      sub: "user:alice",
      iat: now,
      nbf: now,
      exp: now + 30,
      jti: "token",
      tenant_id: "acme",
      session_id: "session",
      act: { sub: "agent:reviewer" }
    })
  ]) {
    await assert.rejects(
      callCheckAccess(request, {
        invocationToken: context.invocation.signPayload(payload)
      }),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }
});

test("refreshes verification keys for an unknown key ID", async () => {
  const context = await arrangeAllow();
  const secondary = await createInvocationAuthority("policy-secondary-key");
  await context.policyd.setVerificationKeys({
    keys: [
      context.invocation.verificationKey,
      secondary.verificationKey
    ],
    expiresAt: new Date(Date.now() + 4 * 60_000).toISOString()
  });
  assert.equal(
    (await callCheckAccess(request, {
      invocationToken: secondary.sign({ tenantId: "acme" })
    })).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
});

test("returns unauthenticated when a successful refresh lacks the key", async () => {
  const context = await arrangeAllow();
  const unknown = await createInvocationAuthority("policy-unknown-key");
  await context.policyd.setVerificationKeys({
    keys: [context.invocation.verificationKey],
    expiresAt: new Date(Date.now() + 4 * 60_000).toISOString()
  });
  await assert.rejects(
    callCheckAccess(request, {
      invocationToken: unknown.sign({ tenantId: "acme" })
    }),
    matchGrpcStatus(status.UNAUTHENTICATED));
});

test("keeps a known current cached key independent of key refresh", async () => {
  const context = await arrangeAllow();
  assert.equal(
    (await callCheckAccess(request)).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
  await context.policyd.setVerificationKeys({
    keys: [],
    expiresAt: new Date(Date.now() + 4 * 60_000).toISOString()
  });
  assert.equal(
    (await callCheckAccess(request)).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
});

async function arrangeAllow() {
  const context = getPolicydTestContext();
  await context.reset();
  await context.policyd.setPrincipalFacts([principalFact()]);
  await context.policyd.replacePolicy({
    roles: [],
    grants: [directGrant("tenants.read", "/tenants/acme")]
  });
  return context;
}
