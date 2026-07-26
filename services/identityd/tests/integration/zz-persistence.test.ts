import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
  createInvocationAuthority
} from "../support/create-invocation-authority.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  createSession
} from "../support/sessions/create-session.js";
import {
  waitForProbeStatus
} from "../support/wait-for-probe-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("every RPC maps required persistence failure to unavailable",
  async () => {
    const context = getIdentitydTestContext();
    const session = await createSession();
    for (const persistenceCase of persistenceCases(
      session.sessionCredential
    )) {
      const unavailableTable =
        `${persistenceCase.table}_unavailable`;
      await context.database.connection.schema.renameTable(
        persistenceCase.table,
        unavailableTable);
      try {
        for (const call of persistenceCase.calls) {
          await assert.rejects(
            call.request(),
            matchGrpcStatus(status.UNAVAILABLE),
            call.name);
        }
      } finally {
        await context.database.connection.schema.renameTable(
          unavailableTable,
          persistenceCase.table);
      }
    }
    await waitForProbeStatus(context.probePort, 204);
  });

test("readiness and RPCs fail closed when a mapped table is missing", async () => {
  const context = getIdentitydTestContext();
  await context.database.connection.schema.renameTable(
    "accounts",
    "accounts_incompatible");
  try {
    await waitForProbeStatus(context.probePort, 503);
    await assert.rejects(
      resolveAlice(),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.database.connection.schema.renameTable(
      "accounts_incompatible",
      "accounts");
  }
  await waitForProbeStatus(context.probePort, 204);
  assert.equal((await resolveAlice()).principalId, "user:alice");
});

test("readiness rejects an ahead or locked migration ledger", async () => {
  const context = getIdentitydTestContext();
  await context.database.connection("knex_migrations").insert({
    name: "9999_unexpected.js",
    batch: 2,
    migration_time: new Date().toISOString()
  });
  try {
    await waitForProbeStatus(context.probePort, 503);
  } finally {
    await context.database.connection("knex_migrations")
      .where({ name: "9999_unexpected.js" })
      .delete();
  }
  await waitForProbeStatus(context.probePort, 204);

  await context.database.connection("knex_migrations_lock")
    .update({ is_locked: 1 });
  try {
    await waitForProbeStatus(context.probePort, 503);
  } finally {
    await context.database.connection("knex_migrations_lock")
      .update({ is_locked: 0 });
  }
  await waitForProbeStatus(context.probePort, 204);
});

test("startup rejects empty and malformed caller admission", async () => {
  const context = getIdentitydTestContext();
  const name = "CTLFLOW_CREATE_SESSION_CALLERS";
  try {
    for (const value of ["", "not-a-kubernetes-service-account"]) {
      await assert.rejects(context.service.restart({ [name]: value }));
    }
  } finally {
    await context.service.restart({
      [name]: context.environment[name]!
    });
  }
  await waitForProbeStatus(context.probePort, 204);
});

test("startup rejects a private and public signing-key mismatch", async () => {
  const context = getIdentitydTestContext();
  const keyId = context.invocation.verificationKey.keyId;
  const original = await context.database.connection<{
    readonly key_id: string;
    readonly modulus_base64url: string;
    readonly exponent_base64url: string;
  }>("invocation_verification_keys")
    .select("modulus_base64url", "exponent_base64url")
    .where({ key_id: keyId })
    .first();
  assert.ok(original !== undefined);
  const mismatched = await createInvocationAuthority(keyId);
  await context.database.connection("invocation_verification_keys")
    .where({ key_id: keyId })
    .update({
      modulus_base64url:
        mismatched.verificationKey.modulusBase64url,
      exponent_base64url:
        mismatched.verificationKey.exponentBase64url
    });
  try {
    await assert.rejects(context.service.restart());
  } finally {
    await context.database.connection("invocation_verification_keys")
      .where({ key_id: keyId })
      .update(original);
    await context.service.restart();
  }
  await waitForProbeStatus(context.probePort, 204);
});

test("SQLite contains only migration metadata and identity domain tables",
  async () => {
    const context = getIdentitydTestContext();
    const objects = await context.database.connection("sqlite_master")
      .select("type", "name")
      .whereIn("type", ["table", "view", "trigger"])
      .orderBy(["type", "name"]) as Array<{
        readonly type: string;
        readonly name: string;
      }>;

    assert.deepEqual(
      objects.filter((object) => object.type === "table")
        .map((object) => object.name),
      [
        "account_group_memberships",
        "accounts",
        "external_identity_links",
        "groups",
        "invocation_verification_keys",
        "knex_migrations",
        "knex_migrations_lock",
        "sessions",
        "sqlite_sequence",
        "tenant_memberships",
        "virtual_principal_group_memberships",
        "virtual_principals",
        "workspace_memberships"
      ]);
    assert.deepEqual(
      objects.filter((object) => object.type === "view"),
      []);
    assert.deepEqual(
      objects.filter((object) => object.type === "trigger"),
      []);
  });

test("persists identity state across a production-process restart", async () => {
  const context = getIdentitydTestContext();
  const before = await resolveAlice();
  const session = await createSession();
  await context.service.restart();
  const after = await resolveAlice();
  assert.deepEqual(after, before);
  const invocation = await exchangeSession(session.sessionCredential);
  assert.match(invocation.invocationJwt, /^[^.]+\.[^.]+\.[^.]+$/u);
});

async function resolveAlice(): Promise<ResolvePrincipalResponse> {
  const context = getIdentitydTestContext();
  return await callUnary<ResolvePrincipalResponse>((done) =>
    context.client.resolvePrincipal(
      {
        principalId: "user:alice",
        tenantId: "acme"
      },
      workloadMetadata(
        context.policydWorkload.callerToken,
        context.invocation.sign({ tenantId: "acme" })),
      done));
}

async function exchangeSession(
  sessionCredential: Buffer
): Promise<IssueInvocationResponse> {
  const context = getIdentitydTestContext();
  return await callUnary<IssueInvocationResponse>((done) =>
    context.client.exchangeSession(
      {
        sessionCredential,
        tenantId: "acme"
      },
      workloadMetadata(context.edgedWorkload.callerToken),
      done));
}

function persistenceCases(
  sessionCredential: Buffer
): readonly {
  readonly table: string;
  readonly calls: readonly {
    readonly name: string;
    readonly request: () => Promise<unknown>;
  }[];
}[] {
  const context = getIdentitydTestContext();
  const invocation = context.invocation.sign({ tenantId: "acme" });
  return [
    {
      table: "invocation_verification_keys",
      calls: [{
        name: "GetInvocationVerificationKeys",
        request: () =>
          callUnary<GetInvocationVerificationKeysResponse>((done) =>
            context.client.getInvocationVerificationKeys(
              {},
              workloadMetadata(context.tenantdWorkload.callerToken),
              done))
      }]
    },
    {
      table: "accounts",
      calls: [
        {
          name: "ResolvePrincipal",
          request: () =>
            callUnary<ResolvePrincipalResponse>((done) =>
              context.client.resolvePrincipal(
                {
                  principalId: "user:alice",
                  tenantId: "acme"
                },
                workloadMetadata(
                  context.policydWorkload.callerToken,
                  invocation),
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
                  runId: "persistence-unavailable"
                },
                workloadMetadata(context.execdWorkload.callerToken),
                done))
        }
      ]
    },
    {
      table: "groups",
      calls: [{
        name: "ListPrincipalGroups",
        request: () =>
          callUnary<ListPrincipalGroupsResponse>((done) =>
            context.client.listPrincipalGroups(
              {
                principalId: "user:alice",
                tenantId: "acme",
                pageSize: 50
              },
              workloadMetadata(
                context.policydWorkload.callerToken,
                invocation),
              done))
      }]
    },
    {
      table: "external_identity_links",
      calls: [{
        name: "CreateSession",
        request: () =>
          callUnary<CreateSessionResponse>((done) =>
            context.client.createSession(
              {
                tenantId: "acme",
                providerId: "oidc",
                providerSubject: "alice@example.com"
              },
              workloadMetadata(context.authdWorkload.callerToken),
              done))
      }]
    },
    {
      table: "sessions",
      calls: [
        {
          name: "ExchangeSession",
          request: () =>
            callUnary<IssueInvocationResponse>((done) =>
              context.client.exchangeSession(
                {
                  sessionCredential,
                  tenantId: "acme"
                },
                workloadMetadata(context.edgedWorkload.callerToken),
                done))
        },
        {
          name: "RevokeSession",
          request: () =>
            callUnary<RevokeSessionResponse>((done) =>
              context.client.revokeSession(
                { sessionCredential },
                workloadMetadata(context.authdWorkload.callerToken),
                done))
        }
      ]
    }
  ];
}
