import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  PrincipalKind,
  type ResolvePrincipalRequest,
  type ResolvePrincipalResponse
} from "../generated/v1/identityd.js";
import {
  getIdentitydTestContext
} from "../suite/get-identityd-test-context.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("resolves current human and service account facts", async () => {
  const human = await resolve(
    {
      principalId: "user:alice",
      tenantId: "acme"
    },
    directUserInvocation());
  assert.deepEqual(human, {
    principalId: "user:alice",
    principalKind: PrincipalKind.PRINCIPAL_KIND_HUMAN,
    principalEnabled: true,
    principalRevision: 1n,
    subjectAccountId: "user:alice",
    subjectAccountEnabled: true,
    subjectAccountRevision: 1n,
    membershipRevision: 21n
  });

  const service = await resolve(
    {
      principalId: "service:automation",
      tenantId: "acme"
    },
    serviceInvocation());
  assert.equal(
    service.principalKind,
    PrincipalKind.PRINCIPAL_KIND_SERVICE);
  assert.equal(service.subjectAccountId, "service:automation");
  assert.equal(service.membershipRevision, 25n);
});

test("resolves virtual principal and attached-account facts", async () => {
  const reviewer = await resolve(
    {
      principalId: "agent:reviewer",
      tenantId: "acme"
    },
    virtualInvocation("agent:reviewer", "user:alice"));
  assert.deepEqual(reviewer, {
    principalId: "agent:reviewer",
    principalKind: PrincipalKind.PRINCIPAL_KIND_VIRTUAL,
    principalEnabled: true,
    principalRevision: 11n,
    subjectAccountId: "user:alice",
    subjectAccountEnabled: true,
    subjectAccountRevision: 1n,
    membershipRevision: 21n
  });
});

test("returns disabled principal and attached-account facts", async () => {
  const account = await resolve(
    {
      principalId: "user:disabled",
      tenantId: "acme"
    },
    directUserInvocation("user:disabled"));
  assert.equal(account.principalEnabled, false);
  assert.equal(account.subjectAccountEnabled, false);

  const principal = await resolve(
    {
      principalId: "agent:disabled",
      tenantId: "acme"
    },
    virtualInvocation("agent:disabled", "user:alice"));
  assert.equal(principal.principalEnabled, false);
  assert.equal(principal.subjectAccountEnabled, true);

  const attached = await resolve(
    {
      principalId: "agent:disabled-account",
      tenantId: "acme"
    },
    virtualInvocation(
      "agent:disabled-account",
      "service:disabled"));
  assert.equal(attached.principalEnabled, true);
  assert.equal(attached.subjectAccountEnabled, false);
});

test("workspace resolution requires both exact memberships", async () => {
  const workspace = await resolve(
    {
      principalId: "user:alice",
      tenantId: "acme",
      workspaceId: "atlas"
    },
    directUserInvocation(
      "user:alice",
      "acme",
      "atlas"));
  assert.equal(workspace.membershipRevision, 31n);

  await assert.rejects(
    resolve(
      {
        principalId: "user:bob",
        tenantId: "acme",
        workspaceId: "atlas"
      },
      directUserInvocation(
        "user:bob",
        "acme",
        "atlas")),
    matchGrpcStatus(status.NOT_FOUND));
});

test("virtual and invocation fences conceal outside targets", async () => {
  const tenant = await resolve(
    {
      principalId: "agent:atlas",
      tenantId: "acme"
    },
    virtualInvocation(
      "agent:atlas",
      "service:automation"));
  assert.equal(tenant.principalId, "agent:atlas");

  const workspace = await resolve(
    {
      principalId: "agent:atlas",
      tenantId: "acme",
      workspaceId: "atlas"
    },
    virtualInvocation(
      "agent:atlas",
      "service:automation",
      "acme",
      "atlas"));
  assert.equal(workspace.membershipRevision, 33n);

  await assert.rejects(
    resolve(
      {
        principalId: "agent:atlas",
        tenantId: "acme",
        workspaceId: "beta"
      },
      virtualInvocation(
        "agent:atlas",
        "service:automation")),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    resolve(
      {
        principalId: "agent:reviewer",
        tenantId: "globex"
      },
      virtualInvocation(
        "agent:reviewer",
        "user:alice",
        "globex")),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    resolve(
      {
        principalId: "user:alice",
        tenantId: "acme",
        workspaceId: "beta"
      },
      directUserInvocation(
        "user:alice",
        "acme",
        "atlas")),
    matchGrpcStatus(status.NOT_FOUND));
});

test("request identity must match the invocation actor and attachment", async () => {
  await assert.rejects(
    resolve(
      {
        principalId: "user:bob",
        tenantId: "acme"
      },
      directUserInvocation()),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    resolve(
      {
        principalId: "agent:reviewer",
        tenantId: "acme"
      },
      virtualInvocation("agent:reviewer", "user:bob")),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    resolve(
      {
        principalId: "agent:unknown",
        tenantId: "acme"
      },
      virtualInvocation("agent:unknown", "user:alice")),
    matchGrpcStatus(status.NOT_FOUND));
});

test("malformed principal and target selectors are invalid", async () => {
  for (const request of [
    { principalId: "", tenantId: "acme" },
    { principalId: "task:unsupported", tenantId: "acme" },
    { principalId: "user:Alice", tenantId: "acme" },
    { principalId: "user:alice", tenantId: "" },
    { principalId: "user:alice", tenantId: "Acme" },
    {
      principalId: "user:alice",
      tenantId: "acme",
      workspaceId: "Atlas"
    }
  ]) {
    await assert.rejects(
      resolve(request, directUserInvocation()),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
});

test("malformed stored principal facts fail unavailable", async () => {
  const context = getIdentitydTestContext();
  await context.database.connection.raw(
    "PRAGMA ignore_check_constraints = ON");
  await context.database.connection("accounts")
    .where({ account_id: "user:alice" })
    .update({ kind: 2 });
  try {
    await assert.rejects(
      resolve(
        {
          principalId: "user:alice",
          tenantId: "acme"
        },
        directUserInvocation()),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.database.connection("accounts")
      .where({ account_id: "user:alice" })
      .update({ kind: 1 });
    await context.database.connection.raw(
      "PRAGMA ignore_check_constraints = OFF");
  }
});

async function resolve(
  request: ResolvePrincipalRequest,
  invocation: string
): Promise<ResolvePrincipalResponse> {
  const context = getIdentitydTestContext();
  return await callUnary<ResolvePrincipalResponse>((done) =>
    context.client.resolvePrincipal(
      request,
      workloadMetadata(
        context.policydWorkload.callerToken,
        invocation),
      done));
}

function directUserInvocation(
  subject = "user:alice",
  tenantId = "acme",
  workspaceId?: string
): string {
  return getIdentitydTestContext().invocation.sign({
    subject,
    tenantId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    tokenId: `principal-${subject.replaceAll(":", "-")}`
  });
}

function serviceInvocation(): string {
  return getIdentitydTestContext().invocation.sign({
    subject: "service:automation",
    tenantId: "acme",
    sessionId: null,
    runId: "service-run",
    tokenId: "principal-service"
  });
}

function virtualInvocation(
  actorSubject: string,
  subject: string,
  tenantId = "acme",
  workspaceId?: string
): string {
  return getIdentitydTestContext().invocation.sign({
    subject,
    actorSubject,
    tenantId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    sessionId: null,
    runId: "agent-run",
    tokenId: `principal-${actorSubject.replaceAll(":", "-")}`
  });
}
