import type {
  CallOptions,
  ClientUnaryCall,
  Metadata,
  ServiceError
} from "@grpc/grpc-js";
import {
  LoginProviderState
} from "../../generated/v1/identityd.js";
import {
  getIdentitydTestContext
} from "../../suite/get-identityd-test-context.js";
import {
  callUnary
} from "../call-unary.js";

export interface AdministrationCall {
  readonly name: string;
  readonly request: (options?: CallOptions) => Promise<unknown>;
  readonly start: (
    options: CallOptions,
    done: (error: ServiceError | null, response: unknown) => void
  ) => ClientUnaryCall;
}

export function createAdministrationCalls(
  metadata: Metadata,
  namespace = "cross_cutting",
  tenantId = "acme"
): readonly AdministrationCall[] {
  const context = getIdentitydTestContext();
  const workspaceId = "atlas";
  const accountId = `user:${namespace}_admin`;
  const groupId = `${namespace}_admin_group`;
  const principalId = `agent:${namespace}_admin`;
  const providerId = `${namespace}_oidc`;
  const providerSubject = `${namespace}@example.com`;
  const provider = {
    tenantId,
    providerId,
    displayName: "Cross-cutting OIDC",
    configurationId: providerId,
    configurationVersionId: `${providerId}_1`,
    secretId: `${providerId}_secret`,
    secretVersionId: `${providerId}_secret_1`
  };

  return [
    call("AddTenantMember", (options, done) =>
      context.client.addTenantMember(
        { tenantId, accountId }, metadata, options, done)),
    call("ListTenantMembers", (options, done) =>
      context.client.listTenantMembers(
        { tenantId, pageSize: 50 }, metadata, options, done)),
    call("AddWorkspaceMember", (options, done) =>
      context.client.addWorkspaceMember(
        { tenantId, workspaceId, accountId },
        metadata,
        options,
        done)),
    call("ListWorkspaceMembers", (options, done) =>
      context.client.listWorkspaceMembers(
        { tenantId, workspaceId, pageSize: 50 },
        metadata,
        options,
        done)),
    call("CreateGroup", (options, done) =>
      context.client.createGroup(
        { tenantId, workspaceId, groupId }, metadata, options, done)),
    call("ListGroups", (options, done) =>
      context.client.listGroups(
        { tenantId, workspaceId, pageSize: 50 },
        metadata,
        options,
        done)),
    call("AddGroupMember", (options, done) =>
      context.client.addGroupMember(
        { tenantId, workspaceId, groupId, principalId: accountId },
        metadata,
        options,
        done)),
    call("ListGroupMembers", (options, done) =>
      context.client.listGroupMembers(
        { tenantId, workspaceId, groupId, pageSize: 50 },
        metadata,
        options,
        done)),
    call("CreateVirtualPrincipal", (options, done) =>
      context.client.createVirtualPrincipal(
        {
          tenantId,
          workspaceId,
          principalId,
          subjectAccountId: accountId
        },
        metadata,
        options,
        done)),
    call("GetVirtualPrincipal", (options, done) =>
      context.client.getVirtualPrincipal(
        { tenantId, workspaceId, principalId },
        metadata,
        options,
        done)),
    call("ListVirtualPrincipals", (options, done) =>
      context.client.listVirtualPrincipals(
        { tenantId, workspaceId, pageSize: 50 },
        metadata,
        options,
        done)),
    call("SetVirtualPrincipalEnabled", (options, done) =>
      context.client.setVirtualPrincipalEnabled(
        {
          tenantId,
          workspaceId,
          principalId,
          expectedRevision: 1n,
          enabled: false
        },
        metadata,
        options,
        done)),
    call("CreateLoginProvider", (options, done) =>
      context.client.createLoginProvider(
        provider, metadata, options, done)),
    call("GetLoginProvider", (options, done) =>
      context.client.getLoginProvider(
        { tenantId, providerId }, metadata, options, done)),
    call("ListLoginProviders", (options, done) =>
      context.client.listLoginProviders(
        { tenantId, pageSize: 50 }, metadata, options, done)),
    call("UpdateLoginProvider", (options, done) =>
      context.client.updateLoginProvider(
        {
          ...provider,
          expectedRevision: 1n,
          displayName: "Cross-cutting workforce",
          configurationVersionId: `${providerId}_2`,
          secretVersionId: `${providerId}_secret_2`
        },
        metadata,
        options,
        done)),
    call("SetLoginProviderState", (options, done) =>
      context.client.setLoginProviderState(
        {
          tenantId,
          providerId,
          expectedRevision: 2n,
          state: LoginProviderState.LOGIN_PROVIDER_STATE_DISABLED
        },
        metadata,
        options,
        done)),
    call("SetWorkspaceLoginProviderAdmission", (options, done) =>
      context.client.setWorkspaceLoginProviderAdmission(
        { tenantId, workspaceId, providerId, admitted: true },
        metadata,
        options,
        done)),
    call("GetWorkspaceLoginProviderAdmission", (options, done) =>
      context.client.getWorkspaceLoginProviderAdmission(
        { tenantId, workspaceId, providerId },
        metadata,
        options,
        done)),
    call("ListWorkspaceLoginProviderAdmissions", (options, done) =>
      context.client.listWorkspaceLoginProviderAdmissions(
        { tenantId, workspaceId, pageSize: 50 },
        metadata,
        options,
        done)),
    call("CreateExternalIdentityLink", (options, done) =>
      context.client.createExternalIdentityLink(
        { tenantId, providerId, providerSubject, accountId },
        metadata,
        options,
        done)),
    call("ListExternalIdentityLinks", (options, done) =>
      context.client.listExternalIdentityLinks(
        { tenantId, providerId, pageSize: 50 },
        metadata,
        options,
        done)),
    call("DeleteExternalIdentityLink", (options, done) =>
      context.client.deleteExternalIdentityLink(
        { tenantId, providerId, providerSubject },
        metadata,
        options,
        done)),
    call("RemoveGroupMember", (options, done) =>
      context.client.removeGroupMember(
        { tenantId, workspaceId, groupId, principalId: accountId },
        metadata,
        options,
        done)),
    call("DeleteGroup", (options, done) =>
      context.client.deleteGroup(
        { tenantId, workspaceId, groupId }, metadata, options, done)),
    call("RemoveWorkspaceMember", (options, done) =>
      context.client.removeWorkspaceMember(
        { tenantId, workspaceId, accountId },
        metadata,
        options,
        done)),
    call("RemoveTenantMember", (options, done) =>
      context.client.removeTenantMember(
        { tenantId, accountId }, metadata, options, done))
  ];
}

function call(
  name: string,
  start: AdministrationCall["start"]
): AdministrationCall {
  return {
    name,
    start,
    request: async (options = {}) =>
      await callUnary((done) => start(options, done))
  };
}
