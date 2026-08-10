using CtlFlow.Audit.Auditd.Domain.Details;

namespace CtlFlow.Audit.Auditd.Domain.Validation;

internal static partial class AuditValidation
{
    private static void ValidateIdentitySession(
        IdentitySessionAuditDetail detail)
    {
        ValidateSessionId(detail.SessionId);
        ValidatePrincipal(
            detail.HumanAccountPrincipalId,
            accountOnly: true,
            humanOnly: true);
        if (detail.Action == 1 && detail.SessionRevision == 1
            || detail.Action == 2 && detail.SessionRevision == 2)
        {
            return;
        }

        throw new ArgumentException(
            "Identity Session audit detail is invalid");
    }

    private static void ValidateIdentityMembership(
        IdentityMembershipAuditDetail detail)
    {
        ValidatePrincipal(detail.AccountPrincipalId, accountOnly: true);
        ValidateOptionalWorkspace(detail.WorkspaceId);
        ValidatePositive(detail.MembershipRevision, "membershipRevision");
        if (detail.Action is not (1 or 2)
            || detail.AccountCreated
                && (detail.Action != 1
                    || detail.WorkspaceId is not null
                    || detail.MembershipRevision != 1))
        {
            throw new ArgumentException(
                "Identity Membership audit detail is invalid");
        }
    }

    private static void ValidateIdentityGroup(
        IdentityGroupAuditDetail detail)
    {
        ValidateCanonicalId(detail.GroupId, 64, "groupId");
        ValidateOptionalWorkspace(detail.WorkspaceId);
        ValidateFiniteAction(detail.Action, 2, "Identity Group");
    }

    private static void ValidateIdentityGroupMember(
        IdentityGroupMemberAuditDetail detail)
    {
        ValidateCanonicalId(detail.GroupId, 64, "groupId");
        ValidatePrincipal(detail.PrincipalId, accountOnly: false);
        ValidateOptionalWorkspace(detail.WorkspaceId);
        ValidateFiniteAction(detail.Action, 2, "Identity Group member");
    }

    private static void ValidateIdentityVirtualPrincipal(
        IdentityVirtualPrincipalAuditDetail detail)
    {
        ValidatePrincipal(detail.PrincipalId, accountOnly: false);
        if (!detail.PrincipalId.StartsWith("agent:", StringComparison.Ordinal))
        {
            throw new ArgumentException(
                "Identity virtual principal must name an agent");
        }
        ValidatePrincipal(
            detail.AttachedAccountPrincipalId,
            accountOnly: true);
        ValidateOptionalWorkspace(detail.WorkspaceId);
        if (detail.Action == 1
            && detail.PrincipalRevision == 1
            && detail.Enabled
            || detail.Action == 2
                && detail.PrincipalRevision >= 2)
        {
            return;
        }

        throw new ArgumentException(
            "Identity virtual-principal audit detail is invalid");
    }

    private static void ValidateIdentityExternalLink(
        IdentityExternalLinkAuditDetail detail)
    {
        ValidateCanonicalId(detail.ProviderId, 64, "providerId");
        ValidatePrincipal(
            detail.HumanAccountPrincipalId,
            accountOnly: true,
            humanOnly: true);
        ValidateFiniteAction(detail.Action, 2, "Identity external link");
    }

    private static void ValidateIdentityLoginProvider(
        IdentityLoginProviderAuditDetail detail)
    {
        ValidateCanonicalId(detail.ProviderId, 64, "providerId");
        if (detail.ResultingState is < 1 or > 3
            || detail.Action == 1
                && (detail.ProviderRevision != 1
                    || detail.ResultingState != 1)
            || detail.Action is 2 or 3
                && detail.ProviderRevision < 2
            || detail.Action is < 1 or > 3)
        {
            throw new ArgumentException(
                "Identity login-provider audit detail is invalid");
        }
    }

    private static void ValidateIdentityWorkspaceProviderAdmission(
        IdentityWorkspaceProviderAdmissionAuditDetail detail)
    {
        ValidateCanonicalId(detail.WorkspaceId, 64, "workspaceId");
        ValidateCanonicalId(detail.ProviderId, 64, "providerId");
        ValidateFiniteAction(
            detail.Action,
            2,
            "Identity Workspace provider admission");
    }

    private static void ValidateOptionalWorkspace(string? workspaceId)
    {
        if (workspaceId is not null)
        {
            ValidateCanonicalId(workspaceId, 64, "workspaceId");
        }
    }

    private static void ValidateFiniteAction(
        int action,
        int maximum,
        string detailName)
    {
        if (action is < 1 || action > maximum)
        {
            throw new ArgumentException($"{detailName} action is invalid");
        }
    }
}
