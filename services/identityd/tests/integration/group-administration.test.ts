import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  PrincipalKind,
  type Group,
  type GroupMember,
  type ListGroupMembersResponse,
  type ListGroupsResponse
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

test("administers exact-target Groups and direct members", async () => {
  const context = getIdentitydTestContext();
  const groupId = "admin_flow_group";
  const groupPath =
    `/tenants/acme/workspaces/atlas/groups/${groupId}`;
  const memberPath = `${groupPath}/members/user:alice`;
  await allowIdentityCapabilities(context, [
    capability("groups.create", groupPath),
    capability(
      "groups.read",
      "/tenants/acme/workspaces/atlas/groups"),
    capability("groups.delete", groupPath),
    capability("group_memberships.add", memberPath),
    capability("group_memberships.remove", memberPath),
    capability("group_memberships.read", `${groupPath}/members`)
  ]);
  const metadata = identityAdminMetadata(context, "acme");
  const selector = {
    tenantId: "acme",
    workspaceId: "atlas",
    groupId
  };

  const created = await callUnary<Group>((callback) =>
    context.client.createGroup(selector, metadata, callback));
  assert.deepEqual(created, selector);
  assert.deepEqual(
    await callUnary<Group>((callback) =>
      context.client.createGroup(selector, metadata, callback)),
    created);

  const groups = await callUnary<ListGroupsResponse>((callback) =>
    context.client.listGroups(
      { tenantId: "acme", workspaceId: "atlas", pageSize: 100 },
      metadata,
      callback));
  assert.equal(
    groups.groups.some((group) => group.groupId === groupId),
    true);

  const member = await callUnary<GroupMember>((callback) =>
    context.client.addGroupMember(
      { ...selector, principalId: "user:alice" },
      metadata,
      callback));
  assert.equal(member.principalId, "user:alice");
  assert.equal(member.principalKind, PrincipalKind.PRINCIPAL_KIND_HUMAN);
  assert.deepEqual(
    await callUnary<GroupMember>((callback) =>
      context.client.addGroupMember(
        { ...selector, principalId: "user:alice" },
        metadata,
        callback)),
    member);

  const members = await callUnary<ListGroupMembersResponse>((callback) =>
    context.client.listGroupMembers(
      { ...selector, pageSize: 1 },
      metadata,
      callback));
  assert.deepEqual(members.members, [member]);

  await callUnary((callback) =>
    context.client.removeGroupMember(
      { ...selector, principalId: "user:alice" },
      metadata,
      callback));
  await callUnary((callback) =>
    context.client.removeGroupMember(
      { ...selector, principalId: "user:alice" },
      metadata,
      callback));
  await callUnary((callback) =>
    context.client.deleteGroup(selector, metadata, callback));
  await callUnary((callback) =>
    context.client.deleteGroup(selector, metadata, callback));
});

test("a Group ID cannot be rebound to another target", async () => {
  const context = getIdentitydTestContext();
  const groupId = "immutable_group_target";
  const tenantPath = `/tenants/acme/groups/${groupId}`;
  const workspacePath =
    `/tenants/acme/workspaces/atlas/groups/${groupId}`;
  await allowIdentityCapabilities(context, [
    capability("groups.create", tenantPath),
    capability("groups.create", workspacePath)
  ]);
  const metadata = identityAdminMetadata(context, "acme");
  await callUnary<Group>((callback) =>
    context.client.createGroup(
      { tenantId: "acme", groupId },
      metadata,
      callback));

  await assert.rejects(
    callUnary<Group>((callback) =>
      context.client.createGroup(
        { tenantId: "acme", workspaceId: "atlas", groupId },
        metadata,
        callback)),
    matchGrpcStatus(status.ALREADY_EXISTS));
});

test("virtual Group members must have standing inside their fence", async () => {
  const context = getIdentitydTestContext();
  const atlasGroup = "virtual_member_atlas";
  const betaGroup = "virtual_member_beta";
  const atlasPath =
    `/tenants/acme/workspaces/atlas/groups/${atlasGroup}`;
  const betaPath =
    `/tenants/acme/workspaces/beta/groups/${betaGroup}`;
  await allowIdentityCapabilities(context, [
    capability("groups.create", atlasPath),
    capability("groups.delete", atlasPath),
    capability(
      "group_memberships.add",
      `${atlasPath}/members/agent:reviewer`),
    capability("groups.create", betaPath),
    capability("groups.delete", betaPath),
    capability(
      "group_memberships.add",
      `${betaPath}/members/agent:atlas`)
  ]);
  const metadata = identityAdminMetadata(context, "acme");
  await callUnary((done) => context.client.createGroup(
    { tenantId: "acme", workspaceId: "atlas", groupId: atlasGroup },
    metadata,
    done));
  const member = await callUnary<GroupMember>((done) =>
    context.client.addGroupMember(
      {
        tenantId: "acme",
        workspaceId: "atlas",
        groupId: atlasGroup,
        principalId: "agent:reviewer"
      },
      metadata,
      done));
  assert.equal(member.principalKind, PrincipalKind.PRINCIPAL_KIND_VIRTUAL);

  await callUnary((done) => context.client.createGroup(
    { tenantId: "acme", workspaceId: "beta", groupId: betaGroup },
    metadata,
    done));
  await assert.rejects(
    callUnary((done) => context.client.addGroupMember(
      {
        tenantId: "acme",
        workspaceId: "beta",
        groupId: betaGroup,
        principalId: "agent:atlas"
      },
      metadata,
      done)),
    matchGrpcStatus(status.NOT_FOUND));

  await callUnary((done) => context.client.deleteGroup(
    { tenantId: "acme", workspaceId: "atlas", groupId: atlasGroup },
    metadata,
    done));
  await callUnary((done) => context.client.deleteGroup(
    { tenantId: "acme", workspaceId: "beta", groupId: betaGroup },
    metadata,
    done));
});

function capability(
  operation: string,
  resourcePath: string
) {
  return {
    operation,
    resourcePath,
    tenantId: "acme"
  };
}
