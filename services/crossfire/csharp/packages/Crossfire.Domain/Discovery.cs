using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record PrincipalSummary(string PrincipalId, string MatrixUserId, string Kind, string DisplayName, string OwnerId, string OwnerMatrixId);
public sealed record PrincipalIdentity(string MatrixUserId, string Kind, string? OwnerMatrixId, string? DisplayName, string? OwnerDisplayName);
public sealed record Role(string Code, string PrincipalKind, string Label);
public sealed record Permission(string Code, string GrantScope, string Description);
public sealed record DiscoveryRequest(int Page, int PageSize, string Kind, string Search, string? ExcludeId = null);
public sealed record DiscoveryPorts(AuthorizationPorts Authorization,
    Func<DiscoveryRequest, Result<Page<PrincipalSummary>>> Principals,
    Func<IReadOnlyList<string>, Result<IReadOnlyList<PrincipalIdentity>>> Identities,
    Func<IReadOnlyList<string>, Result<IReadOnlyList<PrincipalSummary>>> Selected,
    Func<string, Result<IReadOnlyList<Role>>> Roles, Func<Result<IReadOnlyList<Permission>>> Permissions);

public static class Discovery
{
    public static Result<Page<PrincipalSummary>> Principals(DiscoveryPorts ports, Actor actor, DiscoveryRequest input)
    {
        if (input.Kind is not ("all" or "human" or "agent") || input.Page is < 1 or > 100000 || input.PageSize is < 1 or > 100
            || input.Search.Length > 200 || input.Search.Any(value => value is <= '\u001f' or '\u007f')) return Results.Fail<Page<PrincipalSummary>>("invalid", "Invalid bounded identity discovery");
        var authority = Authorization.Require(ports.Authorization, actor, "principal.read");
        return authority.IsSuccess ? ports.Principals(input) : Result<Page<PrincipalSummary>>.Fail(authority.Error);
    }

    public static Result<IReadOnlyList<PrincipalIdentity>> Resolve(DiscoveryPorts ports, Actor actor, IReadOnlyList<string> matrixUserIds)
    {
        var authority = Authorization.Require(ports.Authorization, actor, "principal.read");
        if (!authority.IsSuccess) return Result<IReadOnlyList<PrincipalIdentity>>.Fail(authority.Error);
        if (matrixUserIds.Count is < 1 or > 100 || matrixUserIds.Distinct(StringComparer.Ordinal).Count() != matrixUserIds.Count || matrixUserIds.Any(value => !IdentitySyntax.MatrixUser(value)))
            return Results.Fail<IReadOnlyList<PrincipalIdentity>>("invalid", "Resolve 1–100 unique Matrix identities");
        return ports.Identities(matrixUserIds).Map<IReadOnlyList<PrincipalIdentity>>(values =>
        {
            var byId = values.ToDictionary(value => value.MatrixUserId, StringComparer.Ordinal);
            return matrixUserIds.Select(id => byId.GetValueOrDefault(id) ?? new(id, "unknown", null, null, null)).ToArray();
        });
    }

    public static Result<IReadOnlyList<Role>> Roles(DiscoveryPorts ports, Actor actor)
    {
        var authority = Authorization.Require(ports.Authorization, actor, "principal.read");
        return authority.IsSuccess ? ports.Roles(actor.Kind) : Result<IReadOnlyList<Role>>.Fail(authority.Error);
    }

    public static Result<IReadOnlyList<Permission>> Permissions(DiscoveryPorts ports, Actor actor)
    {
        var authority = Authorization.Require(ports.Authorization, actor, "principal.read");
        return authority.IsSuccess ? ports.Permissions() : Result<IReadOnlyList<Permission>>.Fail(authority.Error);
    }
}
