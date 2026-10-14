using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record AuditEvent(string Id, AuditIntent Intent, long CreatedAt);
public sealed record AuditDetails(AuditEvent Event, PrincipalSummary? Actor, PrincipalSummary? Target);
public sealed record AuditReadPorts(DiscoveryPorts Discovery, Func<string?, int, int, Result<Page<AuditEvent>>> Page);

public static class AuditReads
{
    public static Result<Page<AuditDetails>> List(AuditReadPorts ports, Actor actor, string? ownerId, int page, int size)
    {
        var scope = OwnerScopes.Read(ports.Discovery.Authorization, actor, "audit.read", ownerId); if (!scope.IsSuccess) return Result<Page<AuditDetails>>.Fail(scope.Error);
        var records = ports.Page(scope.Value, page, size); if (!records.IsSuccess) return Result<Page<AuditDetails>>.Fail(records.Error);
        var ids = records.Value.Items.SelectMany(value => new[] { value.Intent.ActorPrincipalId, value.Intent.TargetKind is "agent" or "member" ? value.Intent.TargetId : null }).OfType<string>().Distinct(StringComparer.Ordinal).ToArray();
        var selected = ports.Discovery.Selected(ids); if (!selected.IsSuccess) return Result<Page<AuditDetails>>.Fail(selected.Error);
        var identities = selected.Value.ToDictionary(value => value.PrincipalId, StringComparer.Ordinal);
        return Result<Page<AuditDetails>>.Success(new(records.Value.Items.Select(value => new AuditDetails(value,
            value.Intent.ActorPrincipalId is { } principal ? identities.GetValueOrDefault(principal) : null,
            value.Intent.TargetKind is "agent" or "member" ? identities.GetValueOrDefault(value.Intent.TargetId) : null)).ToArray(), page, size, records.Value.TotalItems));
    }
}
