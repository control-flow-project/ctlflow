import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  status,
  type ClientUnaryCall,
  type ServiceError
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
  createAdministrationCalls
} from "../support/administration/create-administration-calls.js";
import {
  createAdministrationCapabilities
} from "../support/administration/create-administration-capabilities.js";
import {
  allowIdentityCapabilities
} from "../support/authorization/allow-identity-capabilities.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  identityAdminMetadata
} from "../support/identity-admin-metadata.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

interface BlockedOperation {
  readonly name: string;
  readonly start: () => {
    readonly result: Promise<unknown>;
    readonly cancel: () => void;
  };
  readonly deadline: (at: number) => Promise<unknown>;
}

test("every RPC observes in-flight cancellation", async () => {
  const context = getIdentitydTestContext();
  await allowIdentityCapabilities(
    context,
    createAdministrationCapabilities("cancellation"));
  for (const operation of blockedOperations()) {
    await context.database.connection.raw("BEGIN EXCLUSIVE");
    const call = operation.start();
    try {
      await waitUntilRequestAdmission();
      call.cancel();
      await assert.rejects(
        call.result,
        matchGrpcStatus(status.CANCELLED),
        operation.name);
    } finally {
      call.cancel();
      await call.result.catch(() => undefined);
      await context.database.connection.raw("ROLLBACK");
    }
  }
});

test("every RPC observes an in-flight deadline", async () => {
  const context = getIdentitydTestContext();
  await allowIdentityCapabilities(
    context,
    createAdministrationCapabilities("cancellation"));
  for (const operation of blockedOperations()) {
    await context.database.connection.raw("BEGIN EXCLUSIVE");
    const call = operation.deadline(Date.now() + 250);
    try {
      await assert.rejects(
        call,
        matchGrpcStatus(status.DEADLINE_EXCEEDED),
        operation.name);
    } finally {
      await call.catch(() => undefined);
      await context.database.connection.raw("ROLLBACK");
    }
  }
});

function blockedOperations(): readonly BlockedOperation[] {
  const context = getIdentitydTestContext();
  const unknownCredential = randomBytes(32);
  const facts = workloadMetadata(
    context.policydWorkload.callerToken,
    context.invocation.sign({
      tenantId: "acme",
      tokenId: "cancel-facts"
    }));
  const keys = workloadMetadata(
    context.tenantdWorkload.callerToken);
  const authd = workloadMetadata(
    context.authdWorkload.callerToken);
  const edged = workloadMetadata(
    context.edgedWorkload.callerToken);
  const execd = workloadMetadata(
    context.execdWorkload.callerToken);

  const operations: BlockedOperation[] = [
    operation<GetInvocationVerificationKeysResponse>(
      "GetInvocationVerificationKeys",
      (done) => context.client.getInvocationVerificationKeys(
        {},
        keys,
        done),
      (deadline, done) =>
        context.client.getInvocationVerificationKeys(
          {},
          keys,
          { deadline },
          done)),
    operation<ResolvePrincipalResponse>(
      "ResolvePrincipal",
      (done) => context.client.resolvePrincipal(
        {
          principalId: "user:alice",
          tenantId: "acme"
        },
        facts,
        done),
      (deadline, done) => context.client.resolvePrincipal(
        {
          principalId: "user:alice",
          tenantId: "acme"
        },
        facts,
        { deadline },
        done)),
    operation<ListPrincipalGroupsResponse>(
      "ListPrincipalGroups",
      (done) => context.client.listPrincipalGroups(
        {
          principalId: "user:alice",
          tenantId: "acme",
          pageSize: 50
        },
        facts,
        done),
      (deadline, done) => context.client.listPrincipalGroups(
        {
          principalId: "user:alice",
          tenantId: "acme",
          pageSize: 50
        },
        facts,
        { deadline },
        done)),
    operation<CreateSessionResponse>(
      "CreateSession",
      (done) => context.client.createSession(
        {
          tenantId: "acme",
          providerId: "oidc",
          providerSubject: "blocked@example.com"
        },
        authd,
        done),
      (deadline, done) => context.client.createSession(
        {
          tenantId: "acme",
          providerId: "oidc",
          providerSubject: "blocked@example.com"
        },
        authd,
        { deadline },
        done)),
    operation<IssueInvocationResponse>(
      "ExchangeSession",
      (done) => context.client.exchangeSession(
        {
          sessionCredential: unknownCredential,
          tenantId: "acme"
        },
        edged,
        done),
      (deadline, done) => context.client.exchangeSession(
        {
          sessionCredential: unknownCredential,
          tenantId: "acme"
        },
        edged,
        { deadline },
        done)),
    operation<RevokeSessionResponse>(
      "RevokeSession",
      (done) => context.client.revokeSession(
        { sessionCredential: unknownCredential },
        authd,
        done),
      (deadline, done) => context.client.revokeSession(
        { sessionCredential: unknownCredential },
        authd,
        { deadline },
        done)),
    operation<IssueInvocationResponse>(
      "IssueRunInvocation",
      (done) => context.client.issueRunInvocation(
        {
          principalId: "user:alice",
          tenantId: "acme",
          runId: "cancel-run"
        },
        execd,
        done),
      (deadline, done) => context.client.issueRunInvocation(
        {
          principalId: "user:alice",
          tenantId: "acme",
          runId: "deadline-run"
        },
        execd,
        { deadline },
        done))
  ];
  const administration = createAdministrationCalls(
    identityAdminMetadata(context, "acme"),
    "cancellation");
  return [
    ...operations,
    ...administration.map((call) => operation<unknown>(
      call.name,
      (done) => call.start({}, done),
      (deadline, done) => call.start({ deadline }, done)))
  ];
}

function operation<T>(
  name: string,
  start: (
    done: (error: ServiceError | null, response: T) => void
  ) => ClientUnaryCall,
  startWithDeadline: (
    deadline: number,
    done: (error: ServiceError | null, response: T) => void
  ) => ClientUnaryCall
): BlockedOperation {
  return {
    name,
    start: () => startCall(start),
    deadline: async (deadline) =>
      await callUnary<T>((done) =>
        startWithDeadline(deadline, done))
  };
}

function startCall<T>(
  start: (
    callback: (error: ServiceError | null, response: T) => void
  ) => ClientUnaryCall
): {
  readonly result: Promise<T>;
  readonly cancel: () => void;
} {
  let call: ClientUnaryCall | undefined;
  const result = new Promise<T>((resolve, reject) => {
    call = start((error, response) => {
      if (error === null) {
        resolve(response);
      } else {
        reject(error);
      }
    });
    call.on("error", () => undefined);
  });
  return {
    result,
    cancel: () => call?.cancel()
  };
}

async function waitUntilRequestAdmission(): Promise<void> {
  const context = getIdentitydTestContext();
  await assert.rejects(
    callUnary<CreateSessionResponse>((done) =>
      context.client.createSession(
        {
          tenantId: "",
          providerId: "oidc",
          providerSubject: "barrier"
        },
        workloadMetadata(context.authdWorkload.callerToken),
        done)),
    matchGrpcStatus(status.INVALID_ARGUMENT));
}
