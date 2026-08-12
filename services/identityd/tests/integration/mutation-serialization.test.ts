import assert from "node:assert/strict";
import {
  setTimeout as delay
} from "node:timers/promises";
import {
  test
} from "node:test";
import {
  status,
  type Metadata,
  type ServiceError
} from "@grpc/grpc-js";
import {
  LoginProviderState
} from "../generated/v1/identityd.js";
import {
  getIdentitydTestContext
} from "../suite/get-identityd-test-context.js";
import {
  allowIdentityCapabilities
} from "../support/authorization/allow-identity-capabilities.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  identityAdminMetadata
} from "../support/identity-admin-metadata.js";

interface SettledCall {
  readonly status: "fulfilled" | "rejected";
  readonly reason?: unknown;
}

test("serializes Workspace standing and Group membership invariants",
  async () => {
    const context = getIdentitydTestContext();
    const metadata = identityAdminMetadata(context, "acme");
    const suffixes = [
      "race_group_add_first",
      "race_group_remove_first"
    ] as const;
    await allowIdentityCapabilities(context, suffixes.flatMap((suffix) => {
      const accountId = `user:${suffix}`;
      const groupId = `${suffix}_group`;
      const memberPath = `/tenants/acme/members/${accountId}`;
      const workspaceMemberPath =
        `/tenants/acme/workspaces/atlas/members/${accountId}`;
      const groupPath =
        `/tenants/acme/workspaces/atlas/groups/${groupId}`;
      return [
        capability("tenant_memberships.add", memberPath),
        capability("workspace_memberships.add", workspaceMemberPath),
        capability("workspace_memberships.remove", workspaceMemberPath),
        capability("groups.create", groupPath),
        capability(
          "group_memberships.add",
          `${groupPath}/members/${accountId}`)
      ];
    }));

    await runGroupStandingOrder(
      metadata,
      "race_group_add_first",
      true);
    await runGroupStandingOrder(
      metadata,
      "race_group_remove_first",
      false);
  });

test("serializes provider deletion and Workspace admission invariants",
  async () => {
    const context = getIdentitydTestContext();
    const metadata = identityAdminMetadata(context, "acme");
    const providerIds = [
      "race_delete_first",
      "race_admit_first"
    ] as const;
    await allowIdentityCapabilities(
      context,
      providerIds.flatMap((providerId) => [
        capability(
          "login_providers.create",
          `/tenants/acme/login-providers/${providerId}`),
        capability(
          "login_providers.set_state",
          `/tenants/acme/login-providers/${providerId}`),
        capability(
          "workspace_login_provider_admissions.set",
          "/tenants/acme/workspaces/atlas/login-providers/"
            + providerId)
      ]));

    await runProviderAdmissionOrder(
      metadata,
      "race_delete_first",
      false);
    await runProviderAdmissionOrder(
      metadata,
      "race_admit_first",
      true);
  });

test("serializes Tenant standing and external-link invariants", async () => {
  const context = getIdentitydTestContext();
  const metadata = identityAdminMetadata(context, "acme");
  const suffixes = [
    "race_link_create_first",
    "race_member_remove_first"
  ] as const;
  await allowIdentityCapabilities(context, [
    ...suffixes.flatMap((suffix) => {
      const path = `/tenants/acme/members/user:${suffix}`;
      return [
        capability("tenant_memberships.add", path),
        capability("tenant_memberships.remove", path)
      ];
    }),
    capability(
      "external_identity_links.create",
      "/tenants/acme/login-providers/oidc/identity-links")
  ]);

  await runExternalLinkStandingOrder(
    metadata,
    "race_link_create_first",
    true);
  await runExternalLinkStandingOrder(
    metadata,
    "race_member_remove_first",
    false);
});

async function runGroupStandingOrder(
  metadata: Metadata,
  suffix: string,
  addFirst: boolean
): Promise<void> {
  const context = getIdentitydTestContext();
  const accountId = `user:${suffix}`;
  const groupId = `${suffix}_group`;
  await callUnary((done) => context.client.addTenantMember(
    { tenantId: "acme", accountId }, metadata, done));
  await callUnary((done) => context.client.addWorkspaceMember(
    { tenantId: "acme", workspaceId: "atlas", accountId },
    metadata,
    done));
  await callUnary((done) => context.client.createGroup(
    { tenantId: "acme", workspaceId: "atlas", groupId },
    metadata,
    done));

  const add = () => callUnary((done) => context.client.addGroupMember(
    {
      tenantId: "acme",
      workspaceId: "atlas",
      groupId,
      principalId: accountId
    },
    metadata,
    done));
  const remove = () => callUnary((done) =>
    context.client.removeWorkspaceMember(
      { tenantId: "acme", workspaceId: "atlas", accountId },
      metadata,
      done));
  const [first, second] = await runBlockedOrder(
    addFirst ? add : remove,
    addFirst ? remove : add);
  assertFulfilled(first);
  assertRejected(
    second,
    addFirst ? status.FAILED_PRECONDITION : status.NOT_FOUND);

  const memberships = await context.database.connection(
    "account_group_memberships")
    .where({ account_id: accountId, group_id: groupId });
  const standing = await context.database.connection(
    "workspace_memberships")
    .where({
      account_id: accountId,
      tenant_id: "acme",
      workspace_id: "atlas"
    });
  assert.equal(memberships.length, addFirst ? 1 : 0);
  assert.equal(standing.length, addFirst ? 1 : 0);
}

async function runProviderAdmissionOrder(
  metadata: Metadata,
  providerId: string,
  admitFirst: boolean
): Promise<void> {
  const context = getIdentitydTestContext();
  await callUnary((done) => context.client.createLoginProvider(
    {
      tenantId: "acme",
      providerId,
      displayName: providerId,
      configurationId: providerId,
      configurationVersionId: `${providerId}_1`,
      secretId: `${providerId}_secret`,
      secretVersionId: `${providerId}_secret_1`
    },
    metadata,
    done));
  const admit = () => callUnary((done) =>
    context.client.setWorkspaceLoginProviderAdmission(
      {
        tenantId: "acme",
        workspaceId: "atlas",
        providerId,
        admitted: true
      },
      metadata,
      done));
  const remove = () => callUnary((done) =>
    context.client.setLoginProviderState(
      {
        tenantId: "acme",
        providerId,
        expectedRevision: 1n,
        state: LoginProviderState.LOGIN_PROVIDER_STATE_DELETED
      },
      metadata,
      done));
  const [first, second] = await runBlockedOrder(
    admitFirst ? admit : remove,
    admitFirst ? remove : admit);
  assertFulfilled(first);
  if (admitFirst) {
    assertFulfilled(second);
  } else {
    assertRejected(second, status.FAILED_PRECONDITION);
  }

  const admissions = await context.database.connection(
    "workspace_login_provider_admissions")
    .where({
      tenant_id: "acme",
      workspace_id: "atlas",
      provider_id: providerId
    });
  assert.equal(admissions.length, 0);
}

async function runExternalLinkStandingOrder(
  metadata: Metadata,
  suffix: string,
  createFirst: boolean
): Promise<void> {
  const context = getIdentitydTestContext();
  const accountId = `user:${suffix}`;
  const providerSubject = `${suffix}@example.com`;
  await callUnary((done) => context.client.addTenantMember(
    { tenantId: "acme", accountId }, metadata, done));
  const create = () => callUnary((done) =>
    context.client.createExternalIdentityLink(
      {
        tenantId: "acme",
        providerId: "oidc",
        providerSubject,
        accountId
      },
      metadata,
      done));
  const remove = () => callUnary((done) =>
    context.client.removeTenantMember(
      { tenantId: "acme", accountId },
      metadata,
      done));
  const [first, second] = await runBlockedOrder(
    createFirst ? create : remove,
    createFirst ? remove : create);
  assertFulfilled(first);
  assertRejected(second, status.FAILED_PRECONDITION);

  const links = await context.database.connection(
    "external_identity_links")
    .where({
      tenant_id: "acme",
      provider_id: "oidc",
      provider_subject: providerSubject
    });
  const standing = await context.database.connection("tenant_memberships")
    .where({ account_id: accountId, tenant_id: "acme" });
  assert.equal(links.length, createFirst ? 1 : 0);
  assert.equal(standing.length, createFirst ? 1 : 0);
}

async function runBlockedOrder(
  firstCall: () => Promise<unknown>,
  secondCall: () => Promise<unknown>
): Promise<readonly [SettledCall, SettledCall]> {
  const database = getIdentitydTestContext().database.connection;
  await database.raw("BEGIN IMMEDIATE");
  let committed = false;
  try {
    let firstSettled = false;
    const first = settle(firstCall()).finally(() => {
      firstSettled = true;
    });
    await delay(200);
    assert.equal(firstSettled, false, "first mutation did not reach its write");

    let secondSettled = false;
    const second = settle(secondCall()).finally(() => {
      secondSettled = true;
    });
    await delay(100);
    assert.equal(secondSettled, false, "second mutation did not enter the race");
    await database.raw("COMMIT");
    committed = true;
    return [await first, await second];
  } finally {
    if (!committed) {
      await database.raw("ROLLBACK").catch(() => undefined);
    }
  }
}

async function settle(call: Promise<unknown>): Promise<SettledCall> {
  try {
    await call;
    return { status: "fulfilled" };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function assertFulfilled(result: SettledCall): void {
  assert.equal(result.status, "fulfilled", String(result.reason));
}

function assertRejected(result: SettledCall, code: number): void {
  assert.equal(result.status, "rejected");
  assert.equal((result.reason as ServiceError).code, code);
}

function capability(operation: string, resourcePath: string) {
  return { operation, resourcePath, tenantId: "acme" };
}
