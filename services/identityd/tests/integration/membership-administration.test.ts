import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  PrincipalKind,
  type ListTenantMembersResponse,
  type ListWorkspaceMembersResponse,
  type TenantMember,
  type WorkspaceMember
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
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";

test("administers Tenant and Workspace standing over the real policy path",
  async () => {
    const context = getIdentitydTestContext();
    const accountId = "user:membership_flow";
    const tenantPath = `/tenants/acme/members/${accountId}`;
    const workspacePath =
      `/tenants/acme/workspaces/atlas/members/${accountId}`;
    await allowIdentityCapabilities(context, [
      capability("tenant_memberships.add", tenantPath),
      capability("tenant_memberships.read", "/tenants/acme/members"),
      capability("tenant_memberships.remove", tenantPath),
      capability("workspace_memberships.add", workspacePath, "atlas"),
      capability(
        "workspace_memberships.read",
        "/tenants/acme/workspaces/atlas/members",
        "atlas"),
      capability("workspace_memberships.remove", workspacePath, "atlas")
    ]);
    const metadata = identityAdminMetadata(context, "acme");

    const tenantMember = await callUnary<TenantMember>((callback) =>
      context.client.addTenantMember(
        { tenantId: "acme", accountId },
        metadata,
        callback));
    assert.equal(tenantMember.accountId, accountId);
    assert.equal(
      tenantMember.accountKind,
      PrincipalKind.PRINCIPAL_KIND_HUMAN);
    assert.equal(tenantMember.accountEnabled, true);
    assert.equal(tenantMember.accountRevision, 1n);
    assert.equal(tenantMember.membershipRevision, 1n);

    const replay = await callUnary<TenantMember>((callback) =>
      context.client.addTenantMember(
        { tenantId: "acme", accountId },
        metadata,
        callback));
    assert.deepEqual(replay, tenantMember);

    const workspaceMember = await callUnary<WorkspaceMember>((callback) =>
      context.client.addWorkspaceMember(
        { tenantId: "acme", workspaceId: "atlas", accountId },
        metadata,
        callback));
    assert.equal(workspaceMember.workspaceId, "atlas");
    assert.equal(workspaceMember.membershipRevision, 1n);

    const tenantPage = await callUnary<ListTenantMembersResponse>((callback) =>
      context.client.listTenantMembers(
        { tenantId: "acme", pageSize: 1 },
        metadata,
        callback));
    assert.equal(tenantPage.members.length, 1);
    assert.notEqual(tenantPage.nextAfterAccountId, undefined);
    const workspacePage = await callUnary<ListWorkspaceMembersResponse>(
      (callback) =>
      context.client.listWorkspaceMembers(
        { tenantId: "acme", workspaceId: "atlas", pageSize: 1 },
        metadata,
        callback));
    assert.equal(workspacePage.members.length, 1);
    assert.notEqual(workspacePage.nextAfterAccountId, undefined);

    await callUnary((callback) =>
      context.client.removeWorkspaceMember(
        { tenantId: "acme", workspaceId: "atlas", accountId },
        metadata,
        callback));
    await callUnary((callback) =>
      context.client.removeTenantMember(
        { tenantId: "acme", accountId },
        metadata,
        callback));
    await callUnary((callback) =>
      context.client.removeTenantMember(
        { tenantId: "acme", accountId },
        metadata,
        callback));
  });

test("Tenant removal is blocked while Workspace standing remains", async () => {
  const context = getIdentitydTestContext();
  const accountId = "service:membership_guard";
  const tenantPath = `/tenants/acme/members/${accountId}`;
  const workspacePath =
    `/tenants/acme/workspaces/atlas/members/${accountId}`;
  await allowIdentityCapabilities(context, [
    capability("tenant_memberships.add", tenantPath),
    capability("tenant_memberships.remove", tenantPath),
    capability("workspace_memberships.add", workspacePath, "atlas"),
    capability("workspace_memberships.remove", workspacePath, "atlas")
  ]);
  const metadata = identityAdminMetadata(context, "acme");
  await callUnary((callback) =>
    context.client.addTenantMember(
      { tenantId: "acme", accountId },
      metadata,
      callback));
  await callUnary((callback) =>
    context.client.addWorkspaceMember(
      { tenantId: "acme", workspaceId: "atlas", accountId },
      metadata,
      callback));

  await assert.rejects(
    callUnary((callback) =>
      context.client.removeTenantMember(
        { tenantId: "acme", accountId },
        metadata,
        callback)),
    matchGrpcStatus(status.FAILED_PRECONDITION));

  await callUnary((callback) =>
    context.client.removeWorkspaceMember(
      { tenantId: "acme", workspaceId: "atlas", accountId },
      metadata,
      callback));
  await callUnary((callback) =>
    context.client.removeTenantMember(
      { tenantId: "acme", accountId },
      metadata,
      callback));
});

test("standing removal honors Group and external-link guards", async () => {
  const context = getIdentitydTestContext();
  const accountId = "user:standing_guards";
  const groupId = "standing_guards_group";
  const providerSubject = "standing-guards@example.com";
  const tenantPath = `/tenants/acme/members/${accountId}`;
  const workspacePath =
    `/tenants/acme/workspaces/atlas/members/${accountId}`;
  const groupPath =
    `/tenants/acme/workspaces/atlas/groups/${groupId}`;
  const groupMemberPath = `${groupPath}/members/${accountId}`;
  const identityLinksPath =
    "/tenants/acme/login-providers/oidc/identity-links";
  await allowIdentityCapabilities(context, [
    capability("tenant_memberships.add", tenantPath),
    capability("tenant_memberships.remove", tenantPath),
    capability("workspace_memberships.add", workspacePath, "atlas"),
    capability("workspace_memberships.remove", workspacePath, "atlas"),
    capability("groups.create", groupPath, "atlas"),
    capability("groups.delete", groupPath, "atlas"),
    capability("group_memberships.add", groupMemberPath, "atlas"),
    capability("group_memberships.read", `${groupPath}/members`, "atlas"),
    capability("external_identity_links.create", identityLinksPath),
    capability("external_identity_links.delete", identityLinksPath)
  ]);
  const metadata = identityAdminMetadata(context, "acme");
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
  await callUnary((done) => context.client.addGroupMember(
    {
      tenantId: "acme",
      workspaceId: "atlas",
      groupId,
      principalId: accountId
    },
    metadata,
    done));

  await assert.rejects(
    callUnary((done) => context.client.removeWorkspaceMember(
      { tenantId: "acme", workspaceId: "atlas", accountId },
      metadata,
      done)),
    matchGrpcStatus(status.FAILED_PRECONDITION));
  await callUnary((done) => context.client.deleteGroup(
    { tenantId: "acme", workspaceId: "atlas", groupId },
    metadata,
    done));
  await assert.rejects(
    callUnary((done) => context.client.listGroupMembers(
      {
        tenantId: "acme",
        workspaceId: "atlas",
        groupId,
        pageSize: 50
      },
      metadata,
      done)),
    matchGrpcStatus(status.NOT_FOUND));
  await callUnary((done) => context.client.removeWorkspaceMember(
    { tenantId: "acme", workspaceId: "atlas", accountId },
    metadata,
    done));
  await callUnary((done) => context.client.createExternalIdentityLink(
    {
      tenantId: "acme",
      providerId: "oidc",
      providerSubject,
      accountId
    },
    metadata,
    done));

  await assert.rejects(
    callUnary((done) => context.client.removeTenantMember(
      { tenantId: "acme", accountId }, metadata, done)),
    matchGrpcStatus(status.FAILED_PRECONDITION));
  await callUnary((done) => context.client.deleteExternalIdentityLink(
    { tenantId: "acme", providerId: "oidc", providerSubject },
    metadata,
    done));
  await callUnary((done) => context.client.removeTenantMember(
    { tenantId: "acme", accountId }, metadata, done));
});

function capability(
  operation: string,
  resourcePath: string,
  workspaceId?: string
) {
  return {
    operation,
    resourcePath,
    tenantId: "acme",
    ...(workspaceId === undefined ? {} : { workspaceId })
  };
}
