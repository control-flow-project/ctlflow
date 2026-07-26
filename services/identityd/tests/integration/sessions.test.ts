import assert from "node:assert/strict";
import {
  createHash,
  randomBytes
} from "node:crypto";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
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
  createSession
} from "../support/sessions/create-session.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

interface StoredSession {
  readonly session_id: string;
  readonly credential_digest: string;
  readonly account_id: string;
  readonly tenant_id: string;
  readonly created_at_unix_ms: number;
  readonly expires_at_unix_ms: number;
  readonly revoked_at_unix_ms: number | null;
  readonly revision: number;
}

test("creates a digest-only Session and delivers typed audit", async () => {
  const context = getIdentitydTestContext();
  const auditBefore = await context.auditd.readIdentitySessionEvents();
  const before = Date.now();
  const created = await createSession();
  const after = Date.now();

  assert.match(created.sessionId, /^[a-f0-9]{32}$/u);
  assert.equal(created.sessionCredential.length, 32);
  assert.ok(created.expiresAt !== undefined);
  const stored = await readSession(created.sessionId);
  assert.ok(stored !== undefined);
  assert.equal(stored.account_id, "user:alice");
  assert.equal(stored.tenant_id, "acme");
  assert.equal(stored.revoked_at_unix_ms, null);
  assert.equal(stored.revision, 1);
  assert.ok(stored.created_at_unix_ms >= before);
  assert.ok(stored.created_at_unix_ms <= after);
  assert.equal(
    stored.expires_at_unix_ms - stored.created_at_unix_ms,
    12 * 60 * 60 * 1_000);
  assert.equal(
    stored.credential_digest,
    createHash("sha256")
      .update(created.sessionCredential)
      .digest("hex"));
  assert.equal(
    created.expiresAt.getTime(),
    stored.expires_at_unix_ms);

  const auditAfter = await context.auditd.readIdentitySessionEvents();
  assert.equal(auditAfter.length, auditBefore.length + 1);
  const event = auditAfter.at(-1);
  assert.ok(event !== undefined);
  assert.equal(event.operation, "create_session");
  assert.equal(event.action, "created");
  assert.equal(event.sessionId, created.sessionId);
  assert.equal(event.accountPrincipalId, "user:alice");
  assert.equal(event.tenantId, "acme");
  assert.equal(event.sessionRevision, 1n);
  assert.equal(
    event.kubernetesSubject,
    context.authdWorkload.callerSubject);
  const serialized = JSON.stringify(
    event,
    (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value);
  assert.equal(
    serialized.includes(created.sessionCredential.toString("hex")),
    false);
  assert.equal(serialized.includes(stored.credential_digest), false);
  assert.equal(serialized.includes("alice@example.com"), false);
});

test("external login identity is exact and must resolve to standing human",
  async () => {
    for (const providerSubject of [
      "unknown@example.com",
      "Alice@example.com",
      "disabled@example.com",
      "automation@example.com"
    ]) {
      await assert.rejects(
        createSession(providerSubject),
        matchGrpcStatus(status.UNAUTHENTICATED));
    }

    const context = getIdentitydTestContext();
    await context.database.connection.raw("PRAGMA foreign_keys = OFF");
    try {
      await context.database.connection("accounts").insert({
        account_id: "user:nomembership",
        kind: 1,
        enabled: 1,
        revision: 90
      });
      await context.database.connection("external_identity_links").insert({
        tenant_id: "acme",
        provider_id: "oidc",
        provider_subject: "nomembership@example.com",
        account_id: "user:nomembership",
        revision: 91
      });
      await assert.rejects(
        createSession("nomembership@example.com"),
        matchGrpcStatus(status.UNAUTHENTICATED));
    } finally {
      await context.database.connection("external_identity_links")
        .where({ provider_subject: "nomembership@example.com" })
        .delete();
      await context.database.connection("accounts")
        .where({ account_id: "user:nomembership" })
        .delete();
      await context.database.connection.raw("PRAGMA foreign_keys = ON");
    }
});

test("CreateSession rejects malformed non-credential fields", async () => {
  for (const request of [
    {
      tenantId: "",
      providerId: "oidc",
      providerSubject: "alice@example.com"
    },
    {
      tenantId: "Acme",
      providerId: "oidc",
      providerSubject: "alice@example.com"
    },
    {
      tenantId: "acme",
      providerId: "",
      providerSubject: "alice@example.com"
    },
    {
      tenantId: "acme",
      providerId: "OIDC",
      providerSubject: "alice@example.com"
    },
    {
      tenantId: "acme",
      providerId: "oidc",
      providerSubject: ""
    },
    {
      tenantId: "acme",
      providerId: "oidc",
      providerSubject: "x".repeat(513)
    }
  ]) {
    await assert.rejects(
      callCreateSession(request),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
});

test("revocation mutates and audits once, then remains idempotent",
  async () => {
    const context = getIdentitydTestContext();
    const created = await createSession();
    const auditBefore = await context.auditd.readIdentitySessionEvents();

    assert.deepEqual(
      await callRevokeSession(created.sessionCredential),
      {});
    const revoked = await readSession(created.sessionId);
    assert.ok(revoked !== undefined);
    assert.ok(revoked.revoked_at_unix_ms !== null);
    assert.equal(revoked.revision, 2);
    const auditAfter = await context.auditd.readIdentitySessionEvents();
    assert.equal(auditAfter.length, auditBefore.length + 1);
    const event = auditAfter.at(-1);
    assert.ok(event !== undefined);
    assert.equal(event.operation, "revoke_session");
    assert.equal(event.action, "revoked");
    assert.equal(event.sessionId, created.sessionId);
    assert.equal(event.sessionRevision, 2n);

    assert.deepEqual(
      await callRevokeSession(created.sessionCredential),
      {});
    assert.deepEqual(await readSession(created.sessionId), revoked);
    assert.equal(
      (await context.auditd.readIdentitySessionEvents()).length,
      auditAfter.length);
});

test("RevokeSession rejects malformed and unknown credentials", async () => {
  for (const credential of [
    Buffer.alloc(0),
    Buffer.alloc(31),
    Buffer.alloc(33),
    randomBytes(32)
  ]) {
    await assert.rejects(
      callRevokeSession(credential),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }
});

test("concurrent revocation converges on one mutation and audit event",
  async () => {
    const context = getIdentitydTestContext();
    const created = await createSession();
    const auditBefore =
      (await context.auditd.readIdentitySessionEvents()).length;
    await Promise.all([
      callRevokeSession(created.sessionCredential),
      callRevokeSession(created.sessionCredential)
    ]);

    const revoked = await readSession(created.sessionId);
    assert.ok(revoked !== undefined);
    assert.ok(revoked.revoked_at_unix_ms !== null);
    assert.equal(revoked.revision, 2);
    const auditAfter = await context.auditd.readIdentitySessionEvents();
    assert.equal(auditAfter.length, auditBefore + 1);
    assert.equal(auditAfter.at(-1)?.action, "revoked");
  });

test("expiry does not prevent Session revocation", async () => {
  const created = await createSession();
  const stored = await readSession(created.sessionId);
  assert.ok(stored !== undefined);
  await getIdentitydTestContext().database.connection("sessions")
    .where({ session_id: created.sessionId })
    .update({
      expires_at_unix_ms: stored.created_at_unix_ms + 1
    });
  await new Promise((resolve) => setTimeout(resolve, 5));

  await callRevokeSession(created.sessionCredential);
  const revoked = await readSession(created.sessionId);
  assert.ok(revoked !== undefined);
  assert.ok(revoked.revoked_at_unix_ms !== null);
  assert.equal(revoked.revision, 2);
});

test("CreateSession fails unavailable after a committed Auditd failure",
  async () => {
    const context = getIdentitydTestContext();
    const sessionCount = await countSessions();
    const auditCount =
      (await context.auditd.readIdentitySessionEvents()).length;
    await context.auditd.setMode("unavailable");
    try {
      await assert.rejects(
        createSession(),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.auditd.setMode("available");
    }

    assert.equal(await countSessions(), sessionCount + 1);
    assert.equal(
      (await context.auditd.readIdentitySessionEvents()).length,
      auditCount);
});

test("RevokeSession stays revoked after a committed Auditd failure",
  async () => {
    const context = getIdentitydTestContext();
    const created = await createSession();
    const auditCount =
      (await context.auditd.readIdentitySessionEvents()).length;
    await context.auditd.setMode("unavailable");
    try {
      await assert.rejects(
        callRevokeSession(created.sessionCredential),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.auditd.setMode("available");
    }

    const revoked = await readSession(created.sessionId);
    assert.ok(revoked !== undefined);
    assert.ok(revoked.revoked_at_unix_ms !== null);
    assert.equal(revoked.revision, 2);
    await callRevokeSession(created.sessionCredential);
    assert.equal(
      (await context.auditd.readIdentitySessionEvents()).length,
      auditCount);
});

async function callCreateSession(
  request: CreateSessionRequest
): Promise<CreateSessionResponse> {
  const context = getIdentitydTestContext();
  return await callUnary<CreateSessionResponse>((done) =>
    context.client.createSession(
      request,
      workloadMetadata(context.authdWorkload.callerToken),
      done));
}

async function callRevokeSession(
  sessionCredential: Buffer
): Promise<RevokeSessionResponse> {
  const context = getIdentitydTestContext();
  return await callUnary<RevokeSessionResponse>((done) =>
    context.client.revokeSession(
      { sessionCredential },
      workloadMetadata(context.authdWorkload.callerToken),
      done));
}

async function readSession(
  sessionId: string
): Promise<StoredSession | undefined> {
  return await getIdentitydTestContext().database
    .connection<StoredSession>("sessions")
    .where({ session_id: sessionId })
    .first();
}

async function countSessions(): Promise<number> {
  const result = await getIdentitydTestContext().database
    .connection("sessions")
    .count<{ readonly count: number }>("session_id as count")
    .first();
  assert.ok(result !== undefined);
  return Number(result.count);
}
