using CtlFlow.Audit.V1;
using CtlFlow.Identity.Identityd.Domain.Auditing;

namespace CtlFlow.Identity.Identityd.Service.Auditing;

internal static partial class AuditDelivery
{
    private static void SetAuditDetail(
        AuditEvent auditEvent,
        IdentityAuditIntent intent)
    {
        switch (intent)
        {
            case SessionAuditIntent session:
                auditEvent.IdentitySession = CreateSessionDetail(session);
                return;
            case MembershipAuditIntent membership:
                auditEvent.IdentityMembership =
                    CreateMembershipDetail(membership);
                return;
            case GroupAuditIntent group:
                auditEvent.IdentityGroup = CreateGroupDetail(group);
                return;
            case GroupMemberAuditIntent member:
                auditEvent.IdentityGroupMember =
                    CreateGroupMemberDetail(member);
                return;
            case VirtualPrincipalAuditIntent principal:
                auditEvent.IdentityVirtualPrincipal =
                    CreateVirtualPrincipalDetail(principal);
                return;
            case ExternalLinkAuditIntent link:
                auditEvent.IdentityExternalLink =
                    CreateExternalLinkDetail(link);
                return;
            case LoginProviderAuditIntent provider:
                auditEvent.IdentityLoginProvider =
                    CreateLoginProviderDetail(provider);
                return;
            case WorkspaceProviderAdmissionAuditIntent admission:
                auditEvent.IdentityWorkspaceProviderAdmission =
                    CreateWorkspaceProviderAdmissionDetail(admission);
                return;
            default:
                throw new InvalidOperationException(
                    "Identity audit detail is not supported");
        }
    }

    private static IdentitySessionAuditDetail CreateSessionDetail(
        SessionAuditIntent intent) => new()
        {
            SessionId = intent.SessionId.Value,
            HumanAccountPrincipalId = intent.AccountId.Value,
            SessionRevision = checked((ulong)intent.SessionRevision.Value),
            Action = intent.Action switch
            {
                SessionAuditAction.Created => IdentitySessionAction.Created,
                SessionAuditAction.Revoked => IdentitySessionAction.Revoked,
                _ => throw new InvalidOperationException(
                    "Session audit action is invalid")
            }
        };

    private static IdentityMembershipAuditDetail CreateMembershipDetail(
        MembershipAuditIntent intent)
    {
        var detail = new IdentityMembershipAuditDetail
        {
            AccountPrincipalId = intent.AccountId.Value,
            MembershipRevision = checked(
                (ulong)intent.MembershipRevision.Value),
            AccountCreated = intent.AccountCreated,
            Action = intent.Action switch
            {
                MembershipAuditAction.Added =>
                    IdentityMembershipAction.Added,
                MembershipAuditAction.Removed =>
                    IdentityMembershipAction.Removed,
                _ => throw new InvalidOperationException(
                    "Membership audit action is invalid")
            }
        };
        if (intent.WorkspaceId is not null)
        {
            detail.WorkspaceId = intent.WorkspaceId.Value;
        }

        return detail;
    }

    private static IdentityGroupAuditDetail CreateGroupDetail(
        GroupAuditIntent intent)
    {
        var detail = new IdentityGroupAuditDetail
        {
            GroupId = intent.GroupId.Value,
            Action = intent.Action switch
            {
                GroupAuditAction.Created => IdentityGroupAction.Created,
                GroupAuditAction.Deleted => IdentityGroupAction.Deleted,
                _ => throw new InvalidOperationException(
                    "Group audit action is invalid")
            }
        };
        if (intent.WorkspaceId is not null)
        {
            detail.WorkspaceId = intent.WorkspaceId.Value;
        }

        return detail;
    }

    private static IdentityGroupMemberAuditDetail CreateGroupMemberDetail(
        GroupMemberAuditIntent intent)
    {
        var detail = new IdentityGroupMemberAuditDetail
        {
            GroupId = intent.GroupId.Value,
            PrincipalId = intent.PrincipalId.Value,
            Action = intent.Action switch
            {
                GroupMemberAuditAction.Added =>
                    IdentityGroupMemberAction.Added,
                GroupMemberAuditAction.Removed =>
                    IdentityGroupMemberAction.Removed,
                _ => throw new InvalidOperationException(
                    "Group-member audit action is invalid")
            }
        };
        if (intent.WorkspaceId is not null)
        {
            detail.WorkspaceId = intent.WorkspaceId.Value;
        }

        return detail;
    }

    private static IdentityVirtualPrincipalAuditDetail
        CreateVirtualPrincipalDetail(VirtualPrincipalAuditIntent intent)
    {
        var detail = new IdentityVirtualPrincipalAuditDetail
        {
            PrincipalId = intent.PrincipalId.Value,
            AttachedAccountPrincipalId = intent.AttachedAccountId.Value,
            PrincipalRevision = checked(
                (ulong)intent.PrincipalRevision.Value),
            Enabled = intent.Enabled,
            Action = intent.Action switch
            {
                VirtualPrincipalAuditAction.Created =>
                    IdentityVirtualPrincipalAction.Created,
                VirtualPrincipalAuditAction.EnabledStateChanged =>
                    IdentityVirtualPrincipalAction.EnabledStateChanged,
                _ => throw new InvalidOperationException(
                    "Virtual-principal audit action is invalid")
            }
        };
        if (intent.WorkspaceId is not null)
        {
            detail.WorkspaceId = intent.WorkspaceId.Value;
        }

        return detail;
    }

    private static IdentityExternalLinkAuditDetail CreateExternalLinkDetail(
        ExternalLinkAuditIntent intent) => new()
        {
            ExternalLinkId = intent.ExternalLinkId.Value,
            ProviderId = intent.ProviderId.Value,
            HumanAccountPrincipalId = intent.AccountId.Value,
            Action = intent.Action switch
            {
                ExternalLinkAuditAction.Created =>
                    IdentityExternalLinkAction.Created,
                ExternalLinkAuditAction.Deleted =>
                    IdentityExternalLinkAction.Deleted,
                _ => throw new InvalidOperationException(
                    "External-link audit action is invalid")
            }
        };

    private static IdentityLoginProviderAuditDetail
        CreateLoginProviderDetail(LoginProviderAuditIntent intent) => new()
        {
            ProviderId = intent.ProviderId.Value,
            ProviderRevision = checked((ulong)intent.ProviderRevision.Value),
            ResultingState = intent.ResultingState switch
            {
                Domain.Providers.LoginProviderState.Active =>
                    IdentityLoginProviderState.Active,
                Domain.Providers.LoginProviderState.Disabled =>
                    IdentityLoginProviderState.Disabled,
                Domain.Providers.LoginProviderState.Deleted =>
                    IdentityLoginProviderState.Deleted,
                _ => throw new InvalidOperationException(
                    "Login-provider audit state is invalid")
            },
            Action = intent.Action switch
            {
                LoginProviderAuditAction.Created =>
                    IdentityLoginProviderAction.Created,
                LoginProviderAuditAction.Updated =>
                    IdentityLoginProviderAction.Updated,
                LoginProviderAuditAction.StateChanged =>
                    IdentityLoginProviderAction.StateChanged,
                _ => throw new InvalidOperationException(
                    "Login-provider audit action is invalid")
            }
        };

    private static IdentityWorkspaceProviderAdmissionAuditDetail
        CreateWorkspaceProviderAdmissionDetail(
            WorkspaceProviderAdmissionAuditIntent intent) => new()
            {
                WorkspaceId = intent.WorkspaceId.Value,
                ProviderId = intent.ProviderId.Value,
                Action = intent.Action switch
                {
                    WorkspaceProviderAdmissionAuditAction.Admitted =>
                        IdentityWorkspaceProviderAdmissionAction.Admitted,
                    WorkspaceProviderAdmissionAuditAction.Removed =>
                        IdentityWorkspaceProviderAdmissionAction.Removed,
                    _ => throw new InvalidOperationException(
                        "Workspace-provider audit action is invalid")
                }
            };
}
