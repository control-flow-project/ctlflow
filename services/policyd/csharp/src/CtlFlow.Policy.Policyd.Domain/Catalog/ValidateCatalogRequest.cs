using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Domain.Paths;
using CtlFlow.Policy.Policyd.Domain.Targets;
using static CtlFlow.Policy.Policyd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Catalog;

public static partial class OperationCatalog
{
    public static CatalogRequest ValidateCatalogRequest(
        OperationToken operation,
        ResourcePath resourcePath,
        PolicyTarget target)
    {
        var owner = FindOperationOwner(operation)
            ?? throw new InvalidOperationException(
                "Operation is absent from the catalog");
        var account = owner switch
        {
            OperationOwner.Tenantd => ValidateTenantd(
                operation,
                resourcePath,
                target),
            OperationOwner.Pkgd => ValidatePkgd(
                operation,
                resourcePath,
                target),
            OperationOwner.Configd => ValidateConfigd(
                operation,
                resourcePath,
                target),
            OperationOwner.Execd => ValidateExecd(
                operation,
                resourcePath,
                target),
            OperationOwner.Identityd => ValidateIdentityd(
                operation,
                resourcePath,
                target),
            _ => throw new InvalidOperationException(
                "Operation owner is invalid")
        };
        return new CatalogRequest(
            operation,
            resourcePath,
            target,
            account);
    }

    private static PrincipalId? ValidateTenantd(
        OperationToken operation,
        ResourcePath path,
        PolicyTarget target)
    {
        var segments = path.Segments;
        RequireTenantPrefix(segments, target);
        if (operation.Value.StartsWith(
                "tenants.",
                StringComparison.Ordinal))
        {
            RequireTenantTarget(target);
            RequireCount(segments, 2);
            return null;
        }

        RequireFixed(segments, 2, "workspaces");
        if (segments.Count == 3)
        {
            RequireTenantTarget(target);
            if (operation.Value is not ("workspaces.create"
                or "workspaces.read"))
            {
                throw InvalidPath();
            }
            return null;
        }

        RequireCount(segments, 4);
        var workspace = WorkspaceId.Parse(segments[3]);
        if (target.WorkspaceId != workspace
            || operation.Value == "workspaces.create")
        {
            throw InvalidPath();
        }
        return null;
    }

    private static PrincipalId? ValidatePkgd(
        OperationToken operation,
        ResourcePath path,
        PolicyTarget target)
    {
        var scope = ParseScope(path.Segments, target);
        RequireFixed(path.Segments, scope.NextSegment, "apps");
        if (operation.Value == "apps.create")
        {
            RequireCount(path.Segments, scope.NextSegment + 1);
        }
        else
        {
            RequireCount(path.Segments, scope.NextSegment + 2);
            ValidateIdentifier(
                path.Segments[scope.NextSegment + 1],
                64,
                false,
                nameof(path));
        }
        return scope.Account;
    }

    private static PrincipalId? ValidateConfigd(
        OperationToken operation,
        ResourcePath path,
        PolicyTarget target)
    {
        var segments = path.Segments;
        var scope = ParseScope(segments, target);
        var index = scope.NextSegment;
        RequireCount(segments, index + 8);
        RequireFixed(segments, index, "placements");
        ValidateIdentifier(segments[index + 1], 64, false, nameof(path));
        RequireFixed(segments, index + 2, "consumers");
        ValidateIdentifier(segments[index + 3], 64, false, nameof(path));
        RequireFixed(segments, index + 4, "purposes");
        ValidatePurpose(segments[index + 5]);
        var dataKind = operation.Value.StartsWith(
            "configurations.",
            StringComparison.Ordinal)
            ? "configurations"
            : "secrets";
        RequireFixed(segments, index + 6, dataKind);
        ValidateIdentifier(segments[index + 7], 64, false, nameof(path));
        return scope.Account;
    }

    private static PrincipalId? ValidateExecd(
        OperationToken operation,
        ResourcePath path,
        PolicyTarget target)
    {
        var segments = path.Segments;
        var scope = ParseScope(segments, target);
        var index = scope.NextSegment;
        RequireFixed(segments, index, "placements");

        if (operation.Value == "placements.read"
            && segments.Count == index + 1)
        {
            return scope.Account;
        }

        ValidateIdentifier(
            ReadSegment(segments, index + 1),
            64,
            false,
            nameof(path));
        if (operation.Value.StartsWith(
                "placements.",
                StringComparison.Ordinal))
        {
            RequireCount(segments, index + 2);
            return scope.Account;
        }

        RequireFixed(segments, index + 2, "workloads");
        if (operation.Value == "workloads.read"
            && segments.Count == index + 3)
        {
            return scope.Account;
        }
        ValidateIdentifier(
            ReadSegment(segments, index + 3),
            64,
            false,
            nameof(path));
        if (operation.Value.StartsWith(
                "workloads.",
                StringComparison.Ordinal))
        {
            RequireCount(segments, index + 4);
            return scope.Account;
        }

        RequireFixed(segments, index + 4, "runs");
        if (operation.Value == "runs.read"
            && segments.Count == index + 5)
        {
            return scope.Account;
        }
        ValidateIdentifier(
            ReadSegment(segments, index + 5),
            128,
            true,
            nameof(path));
        RequireCount(segments, index + 6);
        return scope.Account;
    }

    private static Scope ParseScope(
        IReadOnlyList<string> segments,
        PolicyTarget target)
    {
        RequireTenantPrefix(segments, target);
        if (segments.Count > 2 && segments[2] == "workspaces")
        {
            var workspace = WorkspaceId.Parse(ReadSegment(segments, 3));
            if (target.WorkspaceId != workspace)
            {
                throw InvalidPath();
            }
            return new Scope(4, null);
        }

        RequireTenantTarget(target);
        if (segments.Count > 2 && segments[2] == "accounts")
        {
            var account = PrincipalId.Parse(ReadSegment(segments, 3));
            if (account.Kind == PrincipalKind.Virtual)
            {
                throw InvalidPath();
            }
            return new Scope(4, account);
        }
        return new Scope(2, null);
    }

    private static void RequireTenantPrefix(
        IReadOnlyList<string> segments,
        PolicyTarget target)
    {
        RequireFixed(segments, 0, "tenants");
        var tenant = TenantId.Parse(ReadSegment(segments, 1));
        if (tenant != target.TenantId)
        {
            throw InvalidPath();
        }
    }

    private static void RequireTenantTarget(PolicyTarget target)
    {
        if (target.WorkspaceId is not null)
        {
            throw InvalidPath();
        }
    }

    private static void ValidatePurpose(string value)
    {
        if (value.Length is < 1 or > 64
            || value[0] is not (>= 'a' and <= 'z')
            || value[^1] == '_')
        {
            throw InvalidPath();
        }

        var previousUnderscore = false;
        foreach (var character in value.AsSpan(1))
        {
            if (character == '_')
            {
                if (previousUnderscore)
                {
                    throw InvalidPath();
                }
                previousUnderscore = true;
                continue;
            }
            if (!IsLowerAlphaNumeric(character))
            {
                throw InvalidPath();
            }
            previousUnderscore = false;
        }
    }

    private static void RequireFixed(
        IReadOnlyList<string> segments,
        int index,
        string expected)
    {
        if (!string.Equals(
                ReadSegment(segments, index),
                expected,
                StringComparison.Ordinal))
        {
            throw InvalidPath();
        }
    }

    private static string ReadSegment(
        IReadOnlyList<string> segments,
        int index) =>
        index >= 0 && index < segments.Count
            ? segments[index]
            : throw InvalidPath();

    private static void RequireCount(
        IReadOnlyCollection<string> segments,
        int count)
    {
        if (segments.Count != count)
        {
            throw InvalidPath();
        }
    }

    private static ArgumentException InvalidPath() =>
        new("Resource path does not match the operation catalog");

    private sealed record Scope(
        int NextSegment,
        PrincipalId? Account);
}
