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

test("maps Identityd outage and caller rejection to unavailable", async () => {
  const context = await arrangeAllow();
  for (const mode of ["unavailable", "denied"] as const) {
    await context.policyd.setIdentityMode(mode);
    try {
      await assert.rejects(
        callCheckAccess(request),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.policyd.setIdentityMode("available");
      await context.policyd.reconnectIdentity();
    }
    assert.equal(
      (await callCheckAccess(request)).decision,
      AccessDecision.ACCESS_DECISION_ALLOW);
  }
});

test("maps malformed stored Identityd facts to unavailable", async () => {
  const context = await arrangeAllow();
  try {
    await context.policyd.corruptPrincipalKind(
      "user:alice",
      "service");
    await assert.rejects(
      callCheckAccess(request),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.policyd.setPrincipalFacts([principalFact()]);
  }
});

test("cancels an in-flight policy database query", async () => {
  const context = await arrangeAllow();
  const metadata = workloadMetadata(
    context.workloads.tenantd.callerToken,
    context.invocation.sign({ tenantId: "acme" }));
  await context.policyd.database.raw("BEGIN EXCLUSIVE");
  let cancel: (() => void) | undefined;
  const blocked = new Promise<never>((_resolve, reject) => {
    const call = context.client.checkAccess(
      request,
      metadata,
      (error) => {
        reject(error ?? new Error("Cancelled call returned no error"));
      });
    call.on("error", () => undefined);
    cancel = () => call.cancel();
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    cancel?.();
    await assert.rejects(
      blocked,
      matchGrpcStatus(status.CANCELLED));
  } finally {
    cancel?.();
    await blocked.catch(() => undefined);
    await context.policyd.database.raw("ROLLBACK");
  }
});

test("honors an in-flight RPC deadline", async () => {
  const context = await arrangeAllow();
  const metadata = workloadMetadata(
    context.workloads.tenantd.callerToken,
    context.invocation.sign({ tenantId: "acme" }));
  await context.policyd.database.raw("BEGIN EXCLUSIVE");
  const blocked = new Promise<never>((_resolve, reject) => {
    const call = context.client.checkAccess(
      request,
      metadata,
      { deadline: Date.now() + 200 },
      (error) => {
        reject(error ?? new Error("Expired call returned no error"));
      });
    call.on("error", () => undefined);
  });
  try {
    await assert.rejects(
      blocked,
      matchGrpcStatus(status.DEADLINE_EXCEEDED));
  } finally {
    await blocked.catch(() => undefined);
    await context.policyd.database.raw("ROLLBACK");
  }
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
