using CtlFlow.Configuration.Configd.Domain.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Bindings;

public static class BindingStorage
{
    public static ConsumerBinding FromStorage(
        int scopeKind,
        string placementId,
        string? tenantId,
        string? workspaceId,
        string? accountPrincipalId,
        string consumerId,
        string purpose)
    {
        PlacementScope scope = scopeKind switch
        {
            1 when tenantId is null
                && workspaceId is null
                && accountPrincipalId is null =>
                new PlacementScope.Global(),
            2 when tenantId is not null
                && workspaceId is null
                && accountPrincipalId is null =>
                new PlacementScope.Tenant(
                    TenantId.FromStorage(tenantId)),
            3 when tenantId is not null
                && workspaceId is not null
                && accountPrincipalId is null =>
                new PlacementScope.Workspace(
                    TenantId.FromStorage(tenantId),
                    WorkspaceId.FromStorage(workspaceId)),
            4 when tenantId is not null
                && workspaceId is null
                && accountPrincipalId is not null =>
                new PlacementScope.User(
                    TenantId.FromStorage(tenantId),
                    AccountPrincipalId.FromStorage(accountPrincipalId)),
            _ => throw new InvalidOperationException(
                "Stored placement scope is invalid")
        };
        return new ConsumerBinding(
            new PlacementBinding(
                PlacementId.FromStorage(placementId),
                scope),
            ConsumerId.FromStorage(consumerId),
            Purpose.FromStorage(purpose));
    }

    public static int GetScopeKind(ConsumerBinding binding) =>
        binding.Placement.Scope switch
        {
            PlacementScope.Global => 1,
            PlacementScope.Tenant => 2,
            PlacementScope.Workspace => 3,
            PlacementScope.User => 4,
            _ => throw new InvalidOperationException(
                "Placement scope is invalid")
        };

    public static string? GetTenantId(ConsumerBinding binding) =>
        binding.Placement.Scope switch
        {
            PlacementScope.Global => null,
            PlacementScope.Tenant tenant => tenant.TenantId.Value,
            PlacementScope.Workspace workspace =>
                workspace.TenantId.Value,
            PlacementScope.User user => user.TenantId.Value,
            _ => throw new InvalidOperationException(
                "Placement scope is invalid")
        };

    public static string? GetWorkspaceId(ConsumerBinding binding) =>
        binding.Placement.Scope is PlacementScope.Workspace workspace
            ? workspace.WorkspaceId.Value
            : null;

    public static string? GetAccountPrincipalId(ConsumerBinding binding) =>
        binding.Placement.Scope is PlacementScope.User user
            ? user.AccountPrincipalId.Value
            : null;
}
