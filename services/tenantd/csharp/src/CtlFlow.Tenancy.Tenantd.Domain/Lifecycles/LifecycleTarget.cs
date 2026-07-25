using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public abstract record LifecycleTarget
{
    private LifecycleTarget()
    {
    }

    public sealed record Tenant(TenantId TenantId) : LifecycleTarget;

    public sealed record Workspace(
        TenantId TenantId,
        WorkspaceId WorkspaceId) : LifecycleTarget;
}
