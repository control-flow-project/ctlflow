import { test } from "node:test";
import {
  IdentityExternalLinkAction,
  IdentityGroupAction,
  IdentityGroupMemberAction,
  IdentityLoginProviderAction,
  IdentityLoginProviderState,
  IdentityMembershipAction,
  IdentityVirtualPrincipalAction,
  IdentityWorkspaceProviderAdmissionAction
} from "../generated/v1/auditd.js";
import {
  getAuditdTestContext
} from "../suite/get-auditd-test-context.js";
import {
  admittedAuditDetail,
  rejectAuditDetailCases
} from "../support/audit-events/reject-audit-detail-cases.js";

test("validates Identity Membership details", async () => {
  const context = getAuditdTestContext();
  const detail = admittedAuditDetail(
    context,
    "identityd",
    "identityMembership");
  await rejectAuditDetailCases(context, detail, [
    ["virtual Membership account", (event) => {
      event.identityMembership!.accountPrincipalId = "agent:member";
    }],
    ["invalid Membership Workspace", (event) => {
      event.identityMembership!.workspaceId = "Upper";
    }],
    ["zero Membership revision", (event) => {
      event.identityMembership!.membershipRevision = 0n;
    }],
    ["unspecified Membership action", (event) => {
      event.identityMembership!.action = IdentityMembershipAction
        .IDENTITY_MEMBERSHIP_ACTION_UNSPECIFIED;
    }],
    ["account created on removal", (event) => {
      event.identityMembership!.action = IdentityMembershipAction
        .IDENTITY_MEMBERSHIP_ACTION_REMOVED;
    }],
    ["account created for Workspace Membership", (event) => {
      event.identityMembership!.workspaceId = "workspace_a";
    }],
    ["account created after revision one", (event) => {
      event.identityMembership!.membershipRevision = 2n;
    }]
  ]);
});

test("validates Identity Group details", async () => {
  const context = getAuditdTestContext();
  const group = admittedAuditDetail(context, "identityd", "identityGroup");
  await rejectAuditDetailCases(context, group, [
    ["invalid Group ID", (event) => {
      event.identityGroup!.groupId = "bad.group";
    }],
    ["invalid Group Workspace", (event) => {
      event.identityGroup!.workspaceId = "Upper";
    }],
    ["unspecified Group action", (event) => {
      event.identityGroup!.action =
        IdentityGroupAction.IDENTITY_GROUP_ACTION_UNSPECIFIED;
    }]
  ]);

  const member = admittedAuditDetail(
    context,
    "identityd",
    "identityGroupMember");
  await rejectAuditDetailCases(context, member, [
    ["invalid member Group ID", (event) => {
      event.identityGroupMember!.groupId = "bad.group";
    }],
    ["invalid Group principal", (event) => {
      event.identityGroupMember!.principalId = "group:nested";
    }],
    ["invalid member Workspace", (event) => {
      event.identityGroupMember!.workspaceId = "Upper";
    }],
    ["unspecified Group member action", (event) => {
      event.identityGroupMember!.action = IdentityGroupMemberAction
        .IDENTITY_GROUP_MEMBER_ACTION_UNSPECIFIED;
    }]
  ]);
});

test("validates Identity virtual-principal details", async () => {
  const context = getAuditdTestContext();
  const detail = admittedAuditDetail(
    context,
    "identityd",
    "identityVirtualPrincipal");
  await rejectAuditDetailCases(context, detail, [
    ["non-virtual principal", (event) => {
      event.identityVirtualPrincipal!.principalId = "user:not_virtual";
    }],
    ["virtual attached account", (event) => {
      event.identityVirtualPrincipal!.attachedAccountPrincipalId =
        "agent:attached";
    }],
    ["invalid virtual-principal Workspace", (event) => {
      event.identityVirtualPrincipal!.workspaceId = "Upper";
    }],
    ["created virtual principal revision", (event) => {
      event.identityVirtualPrincipal!.principalRevision = 2n;
    }],
    ["created disabled virtual principal", (event) => {
      event.identityVirtualPrincipal!.enabled = false;
    }],
    ["state change at revision one", (event) => {
      event.identityVirtualPrincipal!.action =
        IdentityVirtualPrincipalAction
          .IDENTITY_VIRTUAL_PRINCIPAL_ACTION_ENABLED_STATE_CHANGED;
    }],
    ["unspecified virtual-principal action", (event) => {
      event.identityVirtualPrincipal!.action =
        IdentityVirtualPrincipalAction
          .IDENTITY_VIRTUAL_PRINCIPAL_ACTION_UNSPECIFIED;
    }]
  ]);
});

test("validates Identity external-link details", async () => {
  const context = getAuditdTestContext();
  const detail = admittedAuditDetail(
    context,
    "identityd",
    "identityExternalLink");
  await rejectAuditDetailCases(context, detail, [
    ["invalid external-link provider", (event) => {
      event.identityExternalLink!.providerId = "bad.provider";
    }],
    ["service external-link account", (event) => {
      event.identityExternalLink!.humanAccountPrincipalId =
        "service:not_human";
    }],
    ["unspecified external-link action", (event) => {
      event.identityExternalLink!.action = IdentityExternalLinkAction
        .IDENTITY_EXTERNAL_LINK_ACTION_UNSPECIFIED;
    }]
  ]);
});

test("validates Identity login-provider details", async () => {
  const context = getAuditdTestContext();
  const detail = admittedAuditDetail(
    context,
    "identityd",
    "identityLoginProvider");
  await rejectAuditDetailCases(context, detail, [
    ["invalid login-provider ID", (event) => {
      event.identityLoginProvider!.providerId = "bad.provider";
    }],
    ["zero login-provider revision", (event) => {
      event.identityLoginProvider!.providerRevision = 0n;
    }],
    ["created login-provider revision", (event) => {
      event.identityLoginProvider!.providerRevision = 2n;
    }],
    ["created disabled login provider", (event) => {
      event.identityLoginProvider!.resultingState =
        IdentityLoginProviderState
          .IDENTITY_LOGIN_PROVIDER_STATE_DISABLED;
    }],
    ["updated login provider at revision one", (event) => {
      event.identityLoginProvider!.action = IdentityLoginProviderAction
        .IDENTITY_LOGIN_PROVIDER_ACTION_UPDATED;
    }],
    ["unspecified login-provider action", (event) => {
      event.identityLoginProvider!.action = IdentityLoginProviderAction
        .IDENTITY_LOGIN_PROVIDER_ACTION_UNSPECIFIED;
    }],
    ["unspecified login-provider state", (event) => {
      event.identityLoginProvider!.resultingState =
        IdentityLoginProviderState
          .IDENTITY_LOGIN_PROVIDER_STATE_UNSPECIFIED;
    }]
  ]);
});

test("validates Identity Workspace-provider admission details", async () => {
  const context = getAuditdTestContext();
  const detail = admittedAuditDetail(
    context,
    "identityd",
    "identityWorkspaceProviderAdmission");
  await rejectAuditDetailCases(context, detail, [
    ["invalid admission Workspace", (event) => {
      event.identityWorkspaceProviderAdmission!.workspaceId = "Upper";
    }],
    ["invalid admission provider", (event) => {
      event.identityWorkspaceProviderAdmission!.providerId = "bad.provider";
    }],
    ["unspecified admission action", (event) => {
      event.identityWorkspaceProviderAdmission!.action =
        IdentityWorkspaceProviderAdmissionAction
          .IDENTITY_WORKSPACE_PROVIDER_ADMISSION_ACTION_UNSPECIFIED;
    }]
  ]);
});
