using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Domain.Paths;
using CtlFlow.Policy.Policyd.Domain.Targets;
using static CtlFlow.Policy.Policyd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Catalog;

public static partial class OperationCatalog
{
    private static PrincipalId? ValidateIdentityd(
        OperationToken operation,
        ResourcePath path,
        PolicyTarget target)
    {
        if (operation.Value.StartsWith(
                "tenant_memberships.",
                StringComparison.Ordinal))
        {
            ValidateTenantMembershipPath(operation, path, target);
            return null;
        }

        if (operation.Value.StartsWith(
                "workspace_memberships.",
                StringComparison.Ordinal))
        {
            ValidateWorkspaceMembershipPath(operation, path, target);
            return null;
        }

        var next = RequireIdentityTargetPrefix(path.Segments, target);
        if (operation.Value.StartsWith("groups.", StringComparison.Ordinal))
        {
            ValidateGroupPath(operation, path.Segments, next);
        }
        else if (operation.Value.StartsWith(
                     "group_memberships.",
                     StringComparison.Ordinal))
        {
            ValidateGroupMembershipPath(operation, path.Segments, next);
        }
        else if (operation.Value.StartsWith(
                     "virtual_principals.",
                     StringComparison.Ordinal))
        {
            ValidateVirtualPrincipalPath(operation, path.Segments, next);
        }
        else if (operation.Value.StartsWith(
                     "external_identity_links.",
                     StringComparison.Ordinal))
        {
            RequireTenantTarget(target);
            ValidateExternalIdentityLinkPath(path.Segments);
        }
        else if (operation.Value.StartsWith(
                     "login_providers.",
                     StringComparison.Ordinal))
        {
            RequireTenantTarget(target);
            ValidateLoginProviderPath(operation, path.Segments);
        }
        else if (operation.Value.StartsWith(
                     "workspace_login_provider_admissions.",
                     StringComparison.Ordinal))
        {
            ValidateWorkspaceProviderPath(operation, path.Segments, next);
        }
        else
        {
            throw InvalidPath();
        }

        return null;
    }

    private static void ValidateTenantMembershipPath(
        OperationToken operation,
        ResourcePath path,
        PolicyTarget target)
    {
        var segments = path.Segments;
        RequireTenantPrefix(segments, target);
        RequireTenantTarget(target);
        RequireFixed(segments, 2, "members");
        if (operation.Value == "tenant_memberships.read")
        {
            RequireCount(segments, 3);
            return;
        }

        RequireCount(segments, 4);
        RequireAccountPrincipal(ReadSegment(segments, 3));
    }

    private static void ValidateWorkspaceMembershipPath(
        OperationToken operation,
        ResourcePath path,
        PolicyTarget target)
    {
        var segments = path.Segments;
        var next = RequireIdentityTargetPrefix(segments, target);
        if (target.WorkspaceId is null)
        {
            throw InvalidPath();
        }
        RequireFixed(segments, next, "members");
        if (operation.Value == "workspace_memberships.read")
        {
            RequireCount(segments, next + 1);
            return;
        }

        RequireCount(segments, next + 2);
        RequireAccountPrincipal(ReadSegment(segments, next + 1));
    }

    private static void ValidateGroupPath(
        OperationToken operation,
        IReadOnlyList<string> segments,
        int next)
    {
        RequireFixed(segments, next, "groups");
        if (operation.Value == "groups.read")
        {
            RequireCount(segments, next + 1);
            return;
        }

        RequireCount(segments, next + 2);
        ValidateIdentifier(
            ReadSegment(segments, next + 1),
            64,
            false,
            nameof(segments));
    }

    private static void ValidateGroupMembershipPath(
        OperationToken operation,
        IReadOnlyList<string> segments,
        int next)
    {
        RequireFixed(segments, next, "groups");
        ValidateIdentifier(
            ReadSegment(segments, next + 1),
            64,
            false,
            nameof(segments));
        RequireFixed(segments, next + 2, "members");
        if (operation.Value == "group_memberships.read")
        {
            RequireCount(segments, next + 3);
            return;
        }

        RequireCount(segments, next + 4);
        _ = PrincipalId.Parse(ReadSegment(segments, next + 3));
    }

    private static void ValidateVirtualPrincipalPath(
        OperationToken operation,
        IReadOnlyList<string> segments,
        int next)
    {
        RequireFixed(segments, next, "virtual-principals");
        if (operation.Value == "virtual_principals.read"
            && segments.Count == next + 1)
        {
            return;
        }

        RequireCount(segments, next + 2);
        var principal = PrincipalId.Parse(ReadSegment(segments, next + 1));
        if (principal.Kind != PrincipalKind.Virtual)
        {
            throw InvalidPath();
        }
    }

    private static void ValidateExternalIdentityLinkPath(
        IReadOnlyList<string> segments)
    {
        RequireFixed(segments, 2, "login-providers");
        ValidateIdentifier(
            ReadSegment(segments, 3),
            64,
            false,
            nameof(segments));
        RequireFixed(segments, 4, "identity-links");
        RequireCount(segments, 5);
    }

    private static void ValidateLoginProviderPath(
        OperationToken operation,
        IReadOnlyList<string> segments)
    {
        RequireFixed(segments, 2, "login-providers");
        if (operation.Value == "login_providers.read"
            && segments.Count == 3)
        {
            return;
        }

        RequireCount(segments, 4);
        ValidateIdentifier(
            ReadSegment(segments, 3),
            64,
            false,
            nameof(segments));
    }

    private static void ValidateWorkspaceProviderPath(
        OperationToken operation,
        IReadOnlyList<string> segments,
        int next)
    {
        RequireFixed(segments, next, "login-providers");
        if (operation.Value == "workspace_login_provider_admissions.read")
        {
            RequireCount(segments, next + 1);
            return;
        }

        RequireCount(segments, next + 2);
        ValidateIdentifier(
            ReadSegment(segments, next + 1),
            64,
            false,
            nameof(segments));
    }

    private static int RequireIdentityTargetPrefix(
        IReadOnlyList<string> segments,
        PolicyTarget target)
    {
        RequireTenantPrefix(segments, target);
        if (target.WorkspaceId is null)
        {
            return 2;
        }

        RequireFixed(segments, 2, "workspaces");
        var workspace = WorkspaceId.Parse(ReadSegment(segments, 3));
        if (workspace != target.WorkspaceId)
        {
            throw InvalidPath();
        }
        return 4;
    }

    private static void RequireAccountPrincipal(string value)
    {
        if (PrincipalId.Parse(value).Kind == PrincipalKind.Virtual)
        {
            throw InvalidPath();
        }
    }
}
