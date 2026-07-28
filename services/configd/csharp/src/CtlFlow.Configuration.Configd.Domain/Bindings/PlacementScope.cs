using CtlFlow.Configuration.Configd.Domain.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Bindings;

public abstract record PlacementScope
{
    private PlacementScope()
    {
    }

    public sealed record Global : PlacementScope;

    public sealed record Tenant(TenantId TenantId) : PlacementScope;

    public sealed record Workspace(
        TenantId TenantId,
        WorkspaceId WorkspaceId) : PlacementScope;

    public sealed record User(
        TenantId TenantId,
        AccountPrincipalId AccountPrincipalId) : PlacementScope;
}
