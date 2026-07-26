import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Metadata,
  status
} from "@grpc/grpc-js";
import type {
  CreateSessionResponse,
  GetInvocationVerificationKeysResponse,
  IssueInvocationResponse,
  ListPrincipalGroupsResponse,
  ResolvePrincipalResponse,
  RevokeSessionResponse
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

test("every RPC requires an authenticated workload", async () => {
  for (const call of allCalls(new Metadata())) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.UNAUTHENTICATED),
      call.name);
  }
});

test("every RPC rejects an unadmitted workload", async () => {
  const context = getIdentitydTestContext();
  const metadata = workloadMetadata(
    context.policydWorkload.unadmittedToken,
    directInvocation());
  for (const call of allCalls(metadata)) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.PERMISSION_DENIED),
      call.name);
  }
});

test("operation caller sets are exact", async () => {
  const context = getIdentitydTestContext();
  const tenantd = workloadMetadata(
    context.tenantdWorkload.callerToken,
    directInvocation());
  const keys = await callUnary<GetInvocationVerificationKeysResponse>(
    (done) => context.client.getInvocationVerificationKeys(
      {},
      tenantd,
      done));
  assert.equal(keys.keys.length, 1);

  for (const call of factCalls(tenantd)) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.PERMISSION_DENIED),
      call.name);
  }

  for (const caller of [
    {
      name: "tenantd",
      token: context.tenantdWorkload.callerToken,
      allowed: new Set(["GetInvocationVerificationKeys"])
    },
    {
      name: "policyd",
      token: context.policydWorkload.callerToken,
      allowed: new Set([
        "GetInvocationVerificationKeys",
        "ResolvePrincipal",
        "ListPrincipalGroups"
      ])
    },
    {
      name: "authd",
      token: context.authdWorkload.callerToken,
      allowed: new Set(["CreateSession", "RevokeSession"])
    },
    {
      name: "edged",
      token: context.edgedWorkload.callerToken,
      allowed: new Set(["ExchangeSession"])
    },
    {
      name: "execd",
      token: context.execdWorkload.callerToken,
      allowed: new Set(["IssueRunInvocation"])
    }
  ]) {
    const metadata = workloadMetadata(
      caller.token,
      directInvocation());
    for (const call of allCalls(metadata)) {
      if (caller.allowed.has(call.name)) {
        continue;
      }
      await assert.rejects(
        call.request(),
        matchGrpcStatus(status.PERMISSION_DENIED),
        `${caller.name}:${call.name}`);
    }
  }
});

test("malformed and invalid workload tokens are unauthenticated", async () => {
  const context = getIdentitydTestContext();
  for (const token of [
    "not-a-token",
    context.policydWorkload.expiredToken,
    context.policydWorkload.overlongToken,
    context.policydWorkload.unboundToken,
    context.policydWorkload.wrongAudienceToken
  ]) {
    await assert.rejects(
      callUnary<GetInvocationVerificationKeysResponse>((done) =>
        context.client.getInvocationVerificationKeys(
          {},
          workloadMetadata(token),
          done)),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }

  for (const value of [
    "",
    "Basic credential",
    "Bearer",
    "Bearer a b"
  ]) {
    const metadata = new Metadata();
    metadata.set("authorization", value);
    await assert.rejects(
      callUnary<GetInvocationVerificationKeysResponse>((done) =>
        context.client.getInvocationVerificationKeys(
          {},
          metadata,
          done)),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }
});

test("fact RPCs require a valid invocation identity", async () => {
  const context = getIdentitydTestContext();
  const workload = workloadMetadata(
    context.policydWorkload.callerToken);
  for (const call of factCalls(workload)) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.UNAUTHENTICATED),
      call.name);
  }

  for (const token of invalidInvocationTokens()) {
    const metadata = workloadMetadata(
      context.policydWorkload.callerToken,
      token);
    for (const call of factCalls(metadata)) {
      await assert.rejects(
        call.request(),
        matchGrpcStatus(status.UNAUTHENTICATED),
        call.name);
    }
  }
});

test("a supplied invocation on the key RPC is also validated", async () => {
  const context = getIdentitydTestContext();
  await assert.rejects(
    callUnary<GetInvocationVerificationKeysResponse>((done) =>
      context.client.getInvocationVerificationKeys(
        {},
        workloadMetadata(
          context.policydWorkload.callerToken,
          "invalid-invocation"),
        done)),
    matchGrpcStatus(status.UNAUTHENTICATED));
});

test("duplicate invocation metadata is rejected", async () => {
  const context = getIdentitydTestContext();
  const invocation = workloadMetadata(
    context.policydWorkload.callerToken,
    directInvocation());
  invocation.add("ctlflow-invocation", `Bearer ${directInvocation()}`);
  await assert.rejects(
    callUnary<ResolvePrincipalResponse>((done) =>
      context.client.resolvePrincipal(
        principalRequest(),
        invocation,
        done)),
    matchGrpcStatus(status.UNAUTHENTICATED));
});

function allCalls(metadata: Metadata): readonly {
  readonly name: string;
  readonly request: () => Promise<unknown>;
}[] {
  const context = getIdentitydTestContext();
  return [
    {
      name: "GetInvocationVerificationKeys",
      request: () =>
        callUnary<GetInvocationVerificationKeysResponse>((done) =>
          context.client.getInvocationVerificationKeys(
            {},
            metadata,
            done))
    },
    ...factCalls(metadata),
    {
      name: "CreateSession",
      request: () =>
        callUnary<CreateSessionResponse>((done) =>
          context.client.createSession(
            {
              tenantId: "acme",
              providerId: "oidc",
              providerSubject: "alice@example.com"
            },
            metadata,
            done))
    },
    {
      name: "ExchangeSession",
      request: () =>
        callUnary<IssueInvocationResponse>((done) =>
          context.client.exchangeSession(
            {
              sessionCredential: Buffer.alloc(32),
              tenantId: "acme"
            },
            metadata,
            done))
    },
    {
      name: "RevokeSession",
      request: () =>
        callUnary<RevokeSessionResponse>((done) =>
          context.client.revokeSession(
            {
              sessionCredential: Buffer.alloc(32)
            },
            metadata,
            done))
    },
    {
      name: "IssueRunInvocation",
      request: () =>
        callUnary<IssueInvocationResponse>((done) =>
          context.client.issueRunInvocation(
            {
              principalId: "user:alice",
              tenantId: "acme",
              runId: "security-run"
            },
            metadata,
            done))
    }
  ];
}

function factCalls(metadata: Metadata): readonly {
  readonly name: string;
  readonly request: () => Promise<unknown>;
}[] {
  const context = getIdentitydTestContext();
  return [
    {
      name: "ResolvePrincipal",
      request: () =>
        callUnary<ResolvePrincipalResponse>((done) =>
          context.client.resolvePrincipal(
            principalRequest(),
            metadata,
            done))
    },
    {
      name: "ListPrincipalGroups",
      request: () =>
        callUnary<ListPrincipalGroupsResponse>((done) =>
          context.client.listPrincipalGroups(
            {
              ...principalRequest(),
              pageSize: 50
            },
            metadata,
            done))
    }
  ];
}

function principalRequest(): {
  principalId: string;
  tenantId: string;
} {
  return {
    principalId: "user:alice",
    tenantId: "acme"
  };
}

function directInvocation(): string {
  return getIdentitydTestContext().invocation.sign({
    tenantId: "acme",
    tokenId: "security-direct"
  });
}

function invalidInvocationTokens(): readonly string[] {
  const context = getIdentitydTestContext();
  const now = Math.floor(Date.now() / 1_000);
  return [
    "not-a-token",
    context.invocation.sign({
      tenantId: "acme",
      expiresAt: now - 30,
      issuedAt: now - 60,
      notBefore: now - 60
    }),
    context.invocation.sign({
      tenantId: "acme",
      issuer: "https://wrong.example"
    }),
    context.invocation.sign({
      tenantId: "acme",
      audience: "wrong-audience"
    }),
    context.invocation.sign({
      tenantId: "acme",
      expiresAt: now + 61,
      issuedAt: now
    }),
    context.invocation.sign({
      tenantId: "acme",
      sessionId: null
    }),
    context.invocation.sign({
      tenantId: "acme",
      runId: "run-one"
    }),
    context.invocation.sign({
      tenantId: "acme",
      subject: "service:automation"
    }),
    context.invocation.sign({
      tenantId: "acme",
      actorSubject: "agent:reviewer"
    }),
    context.invocation.sign({
      tenantId: "acme",
      subject: "user:alice",
      actorSubject: "user:bob",
      sessionId: null,
      runId: "run-two"
    }),
    context.invocation.sign({
      tenantId: "acme",
      authorityClaim: true
    }),
    context.invocation.sign({
      tenantId: "ACME"
    }),
    context.invocation.sign({
      tenantId: "acme",
      tokenId: "invalid token"
    })
  ];
}
