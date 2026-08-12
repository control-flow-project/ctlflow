import {
  IdentityExternalLinkAction,
  IdentityGroupAction,
  IdentityGroupMemberAction,
  IdentityLoginProviderAction,
  IdentityLoginProviderState,
  IdentityMembershipAction,
  IdentitySessionAction,
  IdentityVirtualPrincipalAction,
  IdentityWorkspaceProviderAdmissionAction,
  type AuditEvent
} from "../../generated/v1/auditd.js";
import {
  createAuditEvent
} from "./create-audit-event.js";
import {
  invocationAttribution
} from "./invocation-attribution.js";
import {
  tenantPartition
} from "./tenant-partition.js";
import {
  workloadAttribution
} from "./workload-attribution.js";

export function createIdentityAuditEvents(
  subject: string
): readonly AuditEvent[] {
  return [
    createAuditEvent({
      identitySession: {
        sessionId: "a".repeat(32),
        humanAccountPrincipalId: "user:matrix_a",
        sessionRevision: 1n,
        action: IdentitySessionAction.IDENTITY_SESSION_ACTION_CREATED
      }
    }, {
      attribution: workloadAttribution(subject),
      partition: tenantPartition("matrix_identity_a")
    }),
    createAuditEvent({
      identitySession: {
        sessionId: "b".repeat(32),
        humanAccountPrincipalId: "user:matrix_b",
        sessionRevision: 2n,
        action: IdentitySessionAction.IDENTITY_SESSION_ACTION_REVOKED
      }
    }, {
      attribution: workloadAttribution(subject),
      partition: tenantPartition("matrix_identity_b")
    }),
    createAuditEvent({
      identityMembership: {
        accountPrincipalId: "user:matrix_member_created",
        membershipRevision: 1n,
        action: IdentityMembershipAction
          .IDENTITY_MEMBERSHIP_ACTION_ADDED,
        accountCreated: true
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_membership_a")
    }),
    createAuditEvent({
      identityMembership: {
        accountPrincipalId: "service:matrix_member",
        workspaceId: "workspace_identity",
        membershipRevision: 2n,
        action: IdentityMembershipAction
          .IDENTITY_MEMBERSHIP_ACTION_REMOVED,
        accountCreated: false
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_membership_b")
    }),
    createAuditEvent({
      identityGroup: {
        groupId: "matrix_group_tenant",
        action: IdentityGroupAction.IDENTITY_GROUP_ACTION_CREATED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_group_a")
    }),
    createAuditEvent({
      identityGroup: {
        groupId: "matrix_group_workspace",
        workspaceId: "workspace_identity",
        action: IdentityGroupAction.IDENTITY_GROUP_ACTION_DELETED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_group_b")
    }),
    createAuditEvent({
      identityGroupMember: {
        groupId: "matrix_group_tenant",
        principalId: "user:matrix_group_member",
        action: IdentityGroupMemberAction
          .IDENTITY_GROUP_MEMBER_ACTION_ADDED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_group_member_a")
    }),
    createAuditEvent({
      identityGroupMember: {
        groupId: "matrix_group_workspace",
        principalId: "agent:matrix_group_member",
        workspaceId: "workspace_identity",
        action: IdentityGroupMemberAction
          .IDENTITY_GROUP_MEMBER_ACTION_REMOVED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_group_member_b")
    }),
    createAuditEvent({
      identityVirtualPrincipal: {
        principalId: "agent:matrix_virtual_a",
        attachedAccountPrincipalId: "user:matrix_virtual_owner_a",
        principalRevision: 1n,
        enabled: true,
        action: IdentityVirtualPrincipalAction
          .IDENTITY_VIRTUAL_PRINCIPAL_ACTION_CREATED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_virtual_a")
    }),
    createAuditEvent({
      identityVirtualPrincipal: {
        principalId: "agent:matrix_virtual_b",
        attachedAccountPrincipalId: "service:matrix_virtual_owner_b",
        workspaceId: "workspace_identity",
        principalRevision: 2n,
        enabled: false,
        action: IdentityVirtualPrincipalAction
          .IDENTITY_VIRTUAL_PRINCIPAL_ACTION_ENABLED_STATE_CHANGED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_virtual_b")
    }),
    createAuditEvent({
      identityExternalLink: {
        externalLinkId: "eil_00000000000000000000000000000001",
        providerId: "matrix_provider_a",
        humanAccountPrincipalId: "user:matrix_link_a",
        action: IdentityExternalLinkAction
          .IDENTITY_EXTERNAL_LINK_ACTION_CREATED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_link_a")
    }),
    createAuditEvent({
      identityExternalLink: {
        externalLinkId: "eil_00000000000000000000000000000002",
        providerId: "matrix_provider_b",
        humanAccountPrincipalId: "user:matrix_link_b",
        action: IdentityExternalLinkAction
          .IDENTITY_EXTERNAL_LINK_ACTION_DELETED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_link_b")
    }),
    createAuditEvent({
      identityLoginProvider: {
        providerId: "matrix_provider_created",
        providerRevision: 1n,
        resultingState: IdentityLoginProviderState
          .IDENTITY_LOGIN_PROVIDER_STATE_ACTIVE,
        action: IdentityLoginProviderAction
          .IDENTITY_LOGIN_PROVIDER_ACTION_CREATED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_provider_a")
    }),
    createAuditEvent({
      identityLoginProvider: {
        providerId: "matrix_provider_updated",
        providerRevision: 2n,
        resultingState: IdentityLoginProviderState
          .IDENTITY_LOGIN_PROVIDER_STATE_ACTIVE,
        action: IdentityLoginProviderAction
          .IDENTITY_LOGIN_PROVIDER_ACTION_UPDATED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_provider_b")
    }),
    createAuditEvent({
      identityLoginProvider: {
        providerId: "matrix_provider_disabled",
        providerRevision: 3n,
        resultingState: IdentityLoginProviderState
          .IDENTITY_LOGIN_PROVIDER_STATE_DISABLED,
        action: IdentityLoginProviderAction
          .IDENTITY_LOGIN_PROVIDER_ACTION_STATE_CHANGED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_provider_c")
    }),
    createAuditEvent({
      identityLoginProvider: {
        providerId: "matrix_provider_deleted",
        providerRevision: 4n,
        resultingState: IdentityLoginProviderState
          .IDENTITY_LOGIN_PROVIDER_STATE_DELETED,
        action: IdentityLoginProviderAction
          .IDENTITY_LOGIN_PROVIDER_ACTION_STATE_CHANGED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_provider_d")
    }),
    createAuditEvent({
      identityWorkspaceProviderAdmission: {
        workspaceId: "workspace_identity_a",
        providerId: "matrix_provider_a",
        action: IdentityWorkspaceProviderAdmissionAction
          .IDENTITY_WORKSPACE_PROVIDER_ADMISSION_ACTION_ADMITTED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_admission_a")
    }),
    createAuditEvent({
      identityWorkspaceProviderAdmission: {
        workspaceId: "workspace_identity_b",
        providerId: "matrix_provider_b",
        action: IdentityWorkspaceProviderAdmissionAction
          .IDENTITY_WORKSPACE_PROVIDER_ADMISSION_ACTION_REMOVED
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_identity_admission_b")
    })
  ];
}
