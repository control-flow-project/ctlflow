import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import type {
  ExchangeSessionRequest,
  GetInvocationVerificationKeysResponse,
  InvocationVerificationKey,
  IssueInvocationResponse,
  IssueRunInvocationRequest,
  RevokeSessionResponse
} from "../generated/v1/identityd.js";
import {
  getIdentitydTestContext
} from "../suite/get-identityd-test-context.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  verifyInvocationJwt,
  type VerifiedInvocationClaims
} from "../support/invocations/verify-invocation-jwt.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  createSession
} from "../support/sessions/create-session.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("exchanges a Session for a signed, bounded invocation", async () => {
  const created = await createSession();
  const before = Math.floor(Date.now() / 1_000);
  const first = await exchangeSession({
    sessionCredential: created.sessionCredential,
    tenantId: "acme"
  });
  const after = Math.floor(Date.now() / 1_000);
  const firstClaims = await verifyIssuedInvocation(first);
  assert.deepEqual(
    Object.keys(firstClaims).sort(),
    [
      "aud",
      "exp",
      "iat",
      "iss",
      "jti",
      "nbf",
      "session_id",
      "sub",
      "tenant_id"
    ]);
  assert.equal(firstClaims.sub, "user:alice");
  assert.equal(firstClaims.tenant_id, "acme");
  assert.equal(firstClaims.session_id, created.sessionId);
  assert.equal(firstClaims.iat, firstClaims.nbf);
  assert.equal(firstClaims.exp, firstClaims.iat + 60);
  assert.ok(firstClaims.iat >= before);
  assert.ok(firstClaims.iat <= after);
  assert.equal(
    first.expiresAt?.getTime(),
    firstClaims.exp * 1_000);

  const second = await exchangeSession({
    sessionCredential: created.sessionCredential,
    tenantId: "acme"
  });
  const secondClaims = await verifyIssuedInvocation(second);
  assert.notEqual(secondClaims.jti, firstClaims.jti);
});

test("Session exchange re-establishes exact target standing", async () => {
  const created = await createSession();
  const workspace = await exchangeSession({
    sessionCredential: created.sessionCredential,
    tenantId: "acme",
    workspaceId: "atlas"
  });
  const claims = await verifyIssuedInvocation(workspace);
  assert.equal(claims.tenant_id, "acme");
  assert.equal(claims.workspace_id, "atlas");

  for (const request of [
    {
      sessionCredential: created.sessionCredential,
      tenantId: "globex"
    },
    {
      sessionCredential: created.sessionCredential,
      tenantId: "acme",
      workspaceId: "unknown"
    }
  ]) {
    await assert.rejects(
      exchangeSession(request),
      matchGrpcStatus(status.NOT_FOUND));
  }
});

test("Session exchange enforces its current Workspace provider admission",
  async () => {
    const context = getIdentitydTestContext();
    const created = await createSession();
    const stored = await context.database.connection<{
      readonly provider_id: string;
    }>("sessions")
      .select("provider_id")
      .where("session_id", created.sessionId)
      .first();
    assert.equal(stored?.provider_id, "oidc");

    const admission = {
      tenant_id: "acme",
      workspace_id: "atlas",
      provider_id: "oidc"
    };
    await context.database.connection("workspace_login_provider_admissions")
      .where(admission)
      .delete();
    try {
      await exchangeSession({
        sessionCredential: created.sessionCredential,
        tenantId: "acme"
      });
      await assert.rejects(
        exchangeSession({
          sessionCredential: created.sessionCredential,
          tenantId: "acme",
          workspaceId: "atlas"
        }),
        matchGrpcStatus(status.NOT_FOUND));

      await context.database.connection(
        "workspace_login_provider_admissions"
      ).insert(admission);
      await exchangeSession({
        sessionCredential: created.sessionCredential,
        tenantId: "acme",
        workspaceId: "atlas"
      });
      await context.database.connection(
        "workspace_login_provider_admissions"
      ).where(admission).delete();
      await assert.rejects(
        exchangeSession({
          sessionCredential: created.sessionCredential,
          tenantId: "acme",
          workspaceId: "atlas"
        }),
        matchGrpcStatus(status.NOT_FOUND));
    } finally {
      await context.database.connection(
        "workspace_login_provider_admissions"
      ).insert(admission).onConflict().ignore();
    }
  });

test("disabling a provider does not revoke its existing Session", async () => {
  const context = getIdentitydTestContext();
  const created = await createSession();
  const selector = { tenant_id: "acme", provider_id: "oidc" };
  await context.database.connection("login_providers")
    .where(selector)
    .update({ state: 2 });
  try {
    await exchangeSession({
      sessionCredential: created.sessionCredential,
      tenantId: "acme",
      workspaceId: "atlas"
    });
  } finally {
    await context.database.connection("login_providers")
      .where(selector)
      .update({ state: 1 });
  }
});

test("Session exchange rejects invalid, expired, and revoked credentials",
  async () => {
    for (const sessionCredential of [
      Buffer.alloc(0),
      Buffer.alloc(31),
      Buffer.alloc(33),
      randomBytes(32)
    ]) {
      await assert.rejects(
        exchangeSession({
          sessionCredential,
          tenantId: "acme"
        }),
        matchGrpcStatus(status.UNAUTHENTICATED));
    }

    const expired = await createSession();
    const context = getIdentitydTestContext();
    const expiredAt = Date.now() - 1_000;
    await context.database.connection("sessions")
      .where({ session_id: expired.sessionId })
      .update({
        created_at_unix_ms: expiredAt - 1,
        expires_at_unix_ms: expiredAt
      });
    await assert.rejects(
      exchangeSession({
        sessionCredential: expired.sessionCredential,
        tenantId: "acme"
      }),
      matchGrpcStatus(status.UNAUTHENTICATED));

    const revoked = await createSession();
    await revokeSession(revoked.sessionCredential);
    await assert.rejects(
      exchangeSession({
        sessionCredential: revoked.sessionCredential,
        tenantId: "acme"
      }),
      matchGrpcStatus(status.UNAUTHENTICATED));
});

test("Session exchange conceals disabled accounts and lost standing",
  async () => {
    const context = getIdentitydTestContext();
    const disabled = await createSession();
    await context.database.connection("accounts")
      .where({ account_id: "user:alice" })
      .update({ enabled: 0 });
    try {
      await assert.rejects(
        exchangeSession({
          sessionCredential: disabled.sessionCredential,
          tenantId: "acme"
        }),
        matchGrpcStatus(status.NOT_FOUND));
    } finally {
      await context.database.connection("accounts")
        .where({ account_id: "user:alice" })
        .update({ enabled: 1 });
    }

    const withoutStanding = await createSession();
    await context.database.connection.raw("PRAGMA foreign_keys = OFF");
    try {
      await context.database.connection("tenant_memberships")
        .where({
          account_id: "user:alice",
          tenant_id: "acme"
        })
        .delete();
      await assert.rejects(
        exchangeSession({
          sessionCredential: withoutStanding.sessionCredential,
          tenantId: "acme"
        }),
        matchGrpcStatus(status.NOT_FOUND));
    } finally {
      await context.database.connection("tenant_memberships").insert({
        account_id: "user:alice",
        tenant_id: "acme",
        revision: 21
      });
      await context.database.connection.raw("PRAGMA foreign_keys = ON");
    }
});

test("malformed Session targets are invalid after credential validation",
  async () => {
    const created = await createSession();
    for (const request of [
      {
        sessionCredential: created.sessionCredential,
        tenantId: ""
      },
      {
        sessionCredential: created.sessionCredential,
        tenantId: "Acme"
      },
      {
        sessionCredential: created.sessionCredential,
        tenantId: "acme",
        workspaceId: "Atlas"
      }
    ]) {
      await assert.rejects(
        exchangeSession(request),
        matchGrpcStatus(status.INVALID_ARGUMENT));
    }
});

test("issues direct and virtual Run invocations with derived identities",
  async () => {
    const human = await issueRunInvocation({
      principalId: "user:alice",
      tenantId: "acme",
      runId: "run-human"
    });
    assert.deepEqual(
      await verifyIssuedInvocation(human),
      expectedRunClaims(
        await verifyIssuedInvocation(human),
        {
          subject: "user:alice",
          tenantId: "acme",
          runId: "run-human"
        }));

    const service = await issueRunInvocation({
      principalId: "service:automation",
      tenantId: "acme",
      runId: "run-service"
    });
    const serviceClaims = await verifyIssuedInvocation(service);
    assert.equal(serviceClaims.sub, "service:automation");
    assert.equal(serviceClaims.run_id, "run-service");
    assert.equal(serviceClaims.act, undefined);

    const virtual = await issueRunInvocation({
      principalId: "agent:atlas",
      tenantId: "acme",
      workspaceId: "atlas",
      runId: "run-agent"
    });
    const virtualClaims = await verifyIssuedInvocation(virtual);
    assert.equal(virtualClaims.sub, "service:automation");
    assert.deepEqual(virtualClaims.act, { sub: "agent:atlas" });
    assert.equal(virtualClaims.tenant_id, "acme");
    assert.equal(virtualClaims.workspace_id, "atlas");
    assert.equal(virtualClaims.run_id, "run-agent");
    assert.equal(virtualClaims.session_id, undefined);
});

test("Run invocation issuance conceals identity, standing, and fences",
  async () => {
    for (const request of [
      {
        principalId: "user:unknown",
        tenantId: "acme",
        runId: "run-unknown"
      },
      {
        principalId: "user:disabled",
        tenantId: "acme",
        runId: "run-disabled"
      },
      {
        principalId: "agent:disabled",
        tenantId: "acme",
        runId: "run-disabled-agent"
      },
      {
        principalId: "agent:disabled-account",
        tenantId: "acme",
        runId: "run-disabled-account"
      },
      {
        principalId: "user:bob",
        tenantId: "acme",
        workspaceId: "atlas",
        runId: "run-no-standing"
      },
      {
        principalId: "agent:atlas",
        tenantId: "acme",
        workspaceId: "beta",
        runId: "run-outside-fence"
      }
    ]) {
      await assert.rejects(
        issueRunInvocation(request),
        matchGrpcStatus(status.NOT_FOUND));
    }
});

test("IssueRunInvocation rejects malformed selectors", async () => {
  for (const request of [
    {
      principalId: "",
      tenantId: "acme",
      runId: "run-one"
    },
    {
      principalId: "task:invalid",
      tenantId: "acme",
      runId: "run-one"
    },
    {
      principalId: "user:alice",
      tenantId: "",
      runId: "run-one"
    },
    {
      principalId: "user:alice",
      tenantId: "acme",
      workspaceId: "Atlas",
      runId: "run-one"
    },
    {
      principalId: "user:alice",
      tenantId: "acme",
      runId: ""
    },
    {
      principalId: "user:alice",
      tenantId: "acme",
      runId: "Run-One"
    }
  ]) {
    await assert.rejects(
      issueRunInvocation(request),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
});

test("exchange and issuance do not create Session audit events",
  async () => {
    const context = getIdentitydTestContext();
    const created = await createSession();
    const before =
      (await context.auditd.readIdentitySessionEvents()).length;
    await exchangeSession({
      sessionCredential: created.sessionCredential,
      tenantId: "acme"
    });
    await issueRunInvocation({
      principalId: "user:alice",
      tenantId: "acme",
      runId: "run-no-audit"
    });
    assert.equal(
      (await context.auditd.readIdentitySessionEvents()).length,
      before);
});

test("malformed stored Session identity fails unavailable", async () => {
  const context = getIdentitydTestContext();
  const created = await createSession();
  await context.database.connection.raw("PRAGMA foreign_keys = OFF");
  try {
    await context.database.connection("sessions")
      .where({ session_id: created.sessionId })
      .update({ account_id: "broken" });
    await assert.rejects(
      exchangeSession({
        sessionCredential: created.sessionCredential,
        tenantId: "acme"
      }),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.database.connection("sessions")
      .where({ session_id: created.sessionId })
      .update({ account_id: "user:alice" });
    await context.database.connection.raw("PRAGMA foreign_keys = ON");
  }
});

test("Session persistence outage fails unavailable", async () => {
  const context = getIdentitydTestContext();
  const created = await createSession();
  await context.database.connection.schema.renameTable(
    "sessions",
    "sessions_unavailable");
  try {
    await assert.rejects(
      exchangeSession({
        sessionCredential: created.sessionCredential,
        tenantId: "acme"
      }),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.database.connection.schema.renameTable(
      "sessions_unavailable",
      "sessions");
  }
});

async function exchangeSession(
  request: ExchangeSessionRequest
): Promise<IssueInvocationResponse> {
  const context = getIdentitydTestContext();
  return await callUnary<IssueInvocationResponse>((done) =>
    context.client.exchangeSession(
      request,
      workloadMetadata(context.edgedWorkload.callerToken),
      done));
}

async function issueRunInvocation(
  request: IssueRunInvocationRequest
): Promise<IssueInvocationResponse> {
  const context = getIdentitydTestContext();
  return await callUnary<IssueInvocationResponse>((done) =>
    context.client.issueRunInvocation(
      request,
      workloadMetadata(context.execdWorkload.callerToken),
      done));
}

async function revokeSession(
  sessionCredential: Buffer
): Promise<RevokeSessionResponse> {
  const context = getIdentitydTestContext();
  return await callUnary<RevokeSessionResponse>((done) =>
    context.client.revokeSession(
      { sessionCredential },
      workloadMetadata(context.authdWorkload.callerToken),
      done));
}

async function verifyIssuedInvocation(
  response: IssueInvocationResponse
): Promise<VerifiedInvocationClaims> {
  return verifyInvocationJwt(
    response.invocationJwt,
    await getCurrentVerificationKey());
}

async function getCurrentVerificationKey():
Promise<InvocationVerificationKey> {
  const context = getIdentitydTestContext();
  const response =
    await callUnary<GetInvocationVerificationKeysResponse>((done) =>
      context.client.getInvocationVerificationKeys(
        {},
        workloadMetadata(context.tenantdWorkload.callerToken),
        done));
  assert.equal(response.keys.length, 1);
  return response.keys[0]!;
}

function expectedRunClaims(
  claims: VerifiedInvocationClaims,
  expected: {
    readonly subject: string;
    readonly tenantId: string;
    readonly runId: string;
  }
): VerifiedInvocationClaims {
  assert.equal(claims.exp, claims.iat + 60);
  assert.equal(claims.nbf, claims.iat);
  return {
    iss: getIdentitydTestContext().invocation.issuer,
    aud: getIdentitydTestContext().invocation.audience,
    sub: expected.subject,
    tenant_id: expected.tenantId,
    run_id: expected.runId,
    iat: claims.iat,
    nbf: claims.nbf,
    exp: claims.exp,
    jti: claims.jti
  };
}
