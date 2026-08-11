import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import type {
  ListExternalIdentityLinksResponse,
  ListGroupMembersResponse,
  ListGroupsResponse,
  ListLoginProvidersResponse,
  ListTenantMembersResponse,
  ListVirtualPrincipalsResponse,
  ListWorkspaceLoginProviderAdmissionsResponse,
  ListWorkspaceMembersResponse
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

test("every administration list uses bounded keyset pagination", async () => {
  const context = getIdentitydTestContext();
  const namespace = "pagination";
  const groupId = `${namespace}_admin_group`;
  const providerId = `${namespace}_oidc`;
  await allowIdentityCapabilities(context, [
    ...createAdministrationCapabilities(namespace),
    {
      operation: "group_memberships.add",
      resourcePath:
        `/tenants/acme/workspaces/atlas/groups/${groupId}`
        + "/members/service:automation",
      tenantId: "acme"
    },
    {
      operation: "workspace_login_provider_admissions.set",
      resourcePath:
        "/tenants/acme/workspaces/atlas/login-providers/oidc",
      tenantId: "acme"
    }
  ]);
  const metadata = identityAdminMetadata(context, "acme");
  const setup = createAdministrationCalls(metadata, namespace);
  for (const call of setup.slice(0, 21)) {
    await call.request();
  }
  await callUnary((done) => context.client.addGroupMember(
    {
      tenantId: "acme",
      workspaceId: "atlas",
      groupId,
      principalId: "service:automation"
    },
    metadata,
    done));
  await callUnary((done) => context.client.createExternalIdentityLink(
    {
      tenantId: "acme",
      providerId,
      providerSubject: "pagination-second@example.com",
      accountId: "user:pagination_admin"
    },
    metadata,
    done));
  await callUnary((done) =>
    context.client.setWorkspaceLoginProviderAdmission(
      {
        tenantId: "acme",
        workspaceId: "atlas",
        providerId: "oidc",
        admitted: true
      },
      metadata,
      done));

  await assertTwoPages(async (after) => {
    const page = await callUnary<ListTenantMembersResponse>((done) =>
      context.client.listTenantMembers(
        { tenantId: "acme", pageSize: 1, ...afterAccount(after) },
        metadata,
        done));
    return { items: page.members, next: page.nextAfterAccountId };
  }, ({ accountId }) => accountId);
  await assertTwoPages(async (after) => {
    const page = await callUnary<ListWorkspaceMembersResponse>((done) =>
      context.client.listWorkspaceMembers(
        {
          tenantId: "acme",
          workspaceId: "atlas",
          pageSize: 1,
          ...afterAccount(after)
        },
        metadata,
        done));
    return { items: page.members, next: page.nextAfterAccountId };
  }, ({ accountId }) => accountId);
  await assertTwoPages(async (after) => {
    const page = await callUnary<ListGroupsResponse>((done) =>
      context.client.listGroups(
        {
          tenantId: "acme",
          workspaceId: "atlas",
          pageSize: 1,
          ...afterGroup(after)
        },
        metadata,
        done));
    return { items: page.groups, next: page.nextAfterGroupId };
  }, ({ groupId: id }) => id);
  await assertTwoPages(async (after) => {
    const page = await callUnary<ListGroupMembersResponse>((done) =>
      context.client.listGroupMembers(
        {
          tenantId: "acme",
          workspaceId: "atlas",
          groupId,
          pageSize: 1,
          ...afterPrincipal(after)
        },
        metadata,
        done));
    return { items: page.members, next: page.nextAfterPrincipalId };
  }, ({ principalId }) => principalId);
  await assertTwoPages(async (after) => {
    const page = await callUnary<ListVirtualPrincipalsResponse>((done) =>
      context.client.listVirtualPrincipals(
        {
          tenantId: "acme",
          workspaceId: "atlas",
          pageSize: 1,
          ...afterPrincipal(after)
        },
        metadata,
        done));
    return { items: page.principals, next: page.nextAfterPrincipalId };
  }, ({ principalId }) => principalId);
  await assertTwoPages(async (after) => {
    const page = await callUnary<ListExternalIdentityLinksResponse>((done) =>
      context.client.listExternalIdentityLinks(
        {
          tenantId: "acme",
          providerId,
          pageSize: 1,
          ...afterSubject(after)
        },
        metadata,
        done));
    return { items: page.links, next: page.nextAfterProviderSubject };
  }, ({ providerSubject }) => providerSubject);
  await assertTwoPages(async (after) => {
    const page = await callUnary<ListLoginProvidersResponse>((done) =>
      context.client.listLoginProviders(
        { tenantId: "acme", pageSize: 1, ...afterProvider(after) },
        metadata,
        done));
    return { items: page.providers, next: page.nextAfterProviderId };
  }, ({ providerId: id }) => id);
  await assertTwoPages(async (after) => {
    const page =
      await callUnary<ListWorkspaceLoginProviderAdmissionsResponse>((done) =>
        context.client.listWorkspaceLoginProviderAdmissions(
          {
            tenantId: "acme",
            workspaceId: "atlas",
            pageSize: 1,
            ...afterProvider(after)
          },
          metadata,
          done));
    return { items: page.admissions, next: page.nextAfterProviderId };
  }, ({ providerId: id }) => id);
});

test("every administration list rejects an oversized page", async () => {
  const context = getIdentitydTestContext();
  const metadata = identityAdminMetadata(context, "acme");
  const requests = [
    () => callUnary((done) => context.client.listTenantMembers(
      { tenantId: "acme", pageSize: 101 }, metadata, done)),
    () => callUnary((done) => context.client.listWorkspaceMembers(
      { tenantId: "acme", workspaceId: "atlas", pageSize: 101 },
      metadata,
      done)),
    () => callUnary((done) => context.client.listGroups(
      { tenantId: "acme", workspaceId: "atlas", pageSize: 101 },
      metadata,
      done)),
    () => callUnary((done) => context.client.listGroupMembers(
      {
        tenantId: "acme",
        workspaceId: "atlas",
        groupId: "pagination_admin_group",
        pageSize: 101
      },
      metadata,
      done)),
    () => callUnary((done) => context.client.listVirtualPrincipals(
      { tenantId: "acme", workspaceId: "atlas", pageSize: 101 },
      metadata,
      done)),
    () => callUnary((done) => context.client.listExternalIdentityLinks(
      { tenantId: "acme", providerId: "pagination_oidc", pageSize: 101 },
      metadata,
      done)),
    () => callUnary((done) => context.client.listLoginProviders(
      { tenantId: "acme", pageSize: 101 }, metadata, done)),
    () => callUnary((done) =>
      context.client.listWorkspaceLoginProviderAdmissions(
        { tenantId: "acme", workspaceId: "atlas", pageSize: 101 },
        metadata,
        done))
  ];

  for (const request of requests) {
    await assert.rejects(
      request(),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
});

async function assertTwoPages<Item>(
  read: (after?: string) => Promise<{
    readonly items: readonly Item[];
    readonly next: string | undefined;
  }>,
  getId: (item: Item) => string
): Promise<void> {
  const first = await read();
  assert.equal(first.items.length, 1);
  assert.notEqual(first.next, undefined);
  const second = await read(first.next);
  assert.equal(second.items.length, 1);
  assert.ok(getId(second.items[0]!) > getId(first.items[0]!));
}

function afterAccount(value?: string) {
  return value === undefined ? {} : { afterAccountId: value };
}

function afterGroup(value?: string) {
  return value === undefined ? {} : { afterGroupId: value };
}

function afterPrincipal(value?: string) {
  return value === undefined ? {} : { afterPrincipalId: value };
}

function afterSubject(value?: string) {
  return value === undefined ? {} : { afterProviderSubject: value };
}

function afterProvider(value?: string) {
  return value === undefined ? {} : { afterProviderId: value };
}
