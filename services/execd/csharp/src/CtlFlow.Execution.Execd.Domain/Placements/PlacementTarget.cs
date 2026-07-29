using CtlFlow.Execution.Execd.Domain.Identifiers;

namespace CtlFlow.Execution.Execd.Domain.Placements;

public abstract record PlacementTarget
{
    private PlacementTarget()
    {
    }

    public sealed record Global : PlacementTarget;

    public sealed record Tenant(TenantId TenantId) : PlacementTarget;

    public sealed record Workspace(
        TenantId TenantId,
        WorkspaceId WorkspaceId) : PlacementTarget;

    public sealed record User(
        TenantId TenantId,
        PrincipalId AccountPrincipalId) : PlacementTarget;

    public TenantId? TenantAnchor => this switch
    {
        Global => null,
        Tenant tenant => tenant.TenantId,
        Workspace workspace => workspace.TenantId,
        User user => user.TenantId,
        _ => throw new InvalidOperationException("Placement target is invalid")
    };
}
