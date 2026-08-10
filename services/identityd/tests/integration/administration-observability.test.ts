import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  LoginProviderState
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
  findSpansForTrace
} from "../support/telemetry/find-spans-for-trace.js";
import {
  hasOperationLog
} from "../support/telemetry/has-operation-log.js";
import {
  readAllExports
} from "../support/telemetry/read-all-exports.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";

test("every administration operation emits telemetry and typed audit",
  async () => {
    const context = getIdentitydTestContext();
    const namespace = "telemetry";
    const traceId = "13579bdf2468ace013579bdf2468ace0";
    await allowIdentityCapabilities(
      context,
      createAdministrationCapabilities(namespace));
    const metadata = identityAdminMetadata(context, "acme");
    metadata.set(
      "traceparent",
      `00-${traceId}-13579bdf2468ace0-01`);
    const calls = createAdministrationCalls(metadata, namespace);
    const auditBefore = (await context.auditd.readEvents()).length;

    for (const call of calls) {
      await call.request();
    }

    const operationNames = calls.map(({ name }) => name);
    assert.equal(new Set(operationNames).size, 26);
    await waitForExport(
      context.collector.logsPath,
      (value) => operationNames.every((operation) =>
        hasOperationLog(value, {
          operation,
          outcome: "OK",
          traceId
        })));
    await waitForExport(
      context.collector.tracesPath,
      (value) => {
        const spans = findSpansForTrace(value, traceId);
        const names = new Set(spans.map(({ name }) => name));
        return operationNames.every((operation) =>
          names.has(`identityd.${operation}`))
          && spans.filter(({ name }) =>
            name === "identityd.CheckAccess").length >= 26
          && spans.filter(({ name }) =>
            name === "identityd.RecordAuditBatch").length >= 16;
      });
    await waitForExport(
      context.collector.metricsPath,
      (value) => operationNames.every((operation) =>
        value.includes(operation)));

    const events = (await context.auditd.readEvents()).slice(auditBefore);
    assert.deepEqual(
      events.map((event) => [event.detailKind, "action" in event
        ? event.action
        : undefined]),
      [
        ["identity_membership", "added"],
        ["identity_membership", "added"],
        ["identity_group", "created"],
        ["identity_group_member", "added"],
        ["identity_virtual_principal", "created"],
        ["identity_virtual_principal", "enabled_state_changed"],
        ["identity_login_provider", "created"],
        ["identity_login_provider", "updated"],
        ["identity_login_provider", "state_changed"],
        ["identity_workspace_provider_admission", "admitted"],
        ["identity_external_link", "created"],
        ["identity_external_link", "deleted"],
        ["identity_group_member", "removed"],
        ["identity_group", "deleted"],
        ["identity_membership", "removed"],
        ["identity_membership", "removed"]
      ]);
    assert.equal(events.every((event) => event.traceId === traceId), true);

    const exports = await readAllExports(context.collector);
    for (const sensitive of [
      "user:telemetry_admin",
      "agent:telemetry_admin",
      "telemetry_admin_group",
      "telemetry_oidc",
      "telemetry@example.com",
      "telemetry_oidc_secret_2",
      "acme",
      "atlas"
    ]) {
      assert.equal(exports.includes(sensitive), false, sensitive);
    }
  });

test("administration no-ops create no audit evidence", async () => {
  const context = getIdentitydTestContext();
  const namespace = "no_op";
  await allowIdentityCapabilities(
    context,
    createAdministrationCapabilities(namespace));
  const metadata = identityAdminMetadata(context, "acme");
  const calls = createAdministrationCalls(
    metadata,
    namespace);
  for (const call of calls.slice(0, 21)) {
    await call.request();
  }
  let auditCount = (await context.auditd.readEvents()).length;

  for (const index of [0, 2, 4, 6, 17, 19]) {
    await calls[index]!.request();
  }
  await callUnary((done) => context.client.setVirtualPrincipalEnabled(
    {
      tenantId: "acme",
      workspaceId: "atlas",
      principalId: "agent:no_op_admin",
      expectedRevision: 2n,
      enabled: false
    },
    metadata,
    done));
  await callUnary((done) => context.client.updateLoginProvider(
    {
      tenantId: "acme",
      providerId: "no_op_oidc",
      expectedRevision: 3n,
      displayName: "Cross-cutting workforce",
      configurationId: "no_op_oidc",
      configurationVersionId: "no_op_oidc_2",
      secretId: "no_op_oidc_secret",
      secretVersionId: "no_op_oidc_secret_2"
    },
    metadata,
    done));
  await callUnary((done) => context.client.setLoginProviderState(
    {
      tenantId: "acme",
      providerId: "no_op_oidc",
      expectedRevision: 3n,
      state: LoginProviderState.LOGIN_PROVIDER_STATE_DISABLED
    },
    metadata,
    done));
  assert.equal((await context.auditd.readEvents()).length, auditCount);

  for (const index of [21, 22, 23, 24, 25]) {
    await calls[index]!.request();
    auditCount++;
    assert.equal((await context.auditd.readEvents()).length, auditCount);
    await calls[index]!.request();
    assert.equal((await context.auditd.readEvents()).length, auditCount);
  }
});

test("an Auditd failure is unavailable after the mutation commits",
  async () => {
    const context = getIdentitydTestContext();
    const namespace = "audit_failure";
    await allowIdentityCapabilities(
      context,
      createAdministrationCapabilities(namespace));
    const calls = createAdministrationCalls(
      identityAdminMetadata(context, "acme"),
      namespace);
    const auditBefore = (await context.auditd.readEvents()).length;
    await context.auditd.setMode("unavailable");
    try {
      await assert.rejects(
        calls[0]!.request(),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.auditd.setMode("available");
    }

    const members = await calls[1]!.request() as {
      readonly members: readonly { readonly accountId: string }[];
    };
    assert.equal(
      members.members.some(({ accountId }) =>
        accountId === "user:audit_failure_admin"),
      true);
    await calls[0]!.request();
    assert.equal((await context.auditd.readEvents()).length, auditBefore);
  });
